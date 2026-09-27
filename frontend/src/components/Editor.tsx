import { useEffect, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';
import { PluginBoundary, usePluginEditor, usePlugins } from '../plugins/PluginProvider';

// Use the locally bundled Monaco instance instead of the default behavior of
// fetching Monaco from the jsdelivr CDN at runtime. This keeps the editor
// working with zero network access, matching the "local-first, zero cloud
// dependency" goal.
loader.config({ monaco });

// Monaco's language services run in web workers. Each worker script is
// bundled locally via the `new Worker(new URL('literal', import.meta.url))`
// pattern (no CDN, no runtime fetch) — the bundler-agnostic form of Vite's
// worker handling, needed because this project's Vite build uses the
// rolldown bundler, which does not support the `?worker` import suffix for
// this package's exports. Each `new Worker(new URL(...))` must appear as a
// single literal expression (not split into an intermediate variable) so
// the bundler's static worker-chunking detection recognizes it; splitting
// it causes the worker script to be inlined as an unusable `data:` URL.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') {
      return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' });
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' });
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' });
    }
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' });
    }
    return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });
  },
};

interface Document { content: string; saved: string; conflict: boolean; loaded: boolean }
function isBinaryDatabase(path: string | null | undefined): boolean { return !!path && /\.(?:db|sqlite|sqlite3|parquet)$/i.test(path); }
export function Editor({ client, path, openVersion = 0, onDirtyChange, theme = 'dark' }: { client: WsClient; path: string | null; openVersion?: number; onDirtyChange?: (dirty: boolean) => void; theme?: Theme }) {
  const [documents, setDocuments] = useState<Record<string, Document>>({});
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');
  const activeRegistration = usePluginEditor(active ?? '');
  useEffect(() => { onDirtyChange?.(Object.values(documents).some(doc => doc.content !== doc.saved)); }, [documents, onDirtyChange]);
  const docs = useRef(documents);
  docs.current = documents;
  useEffect(() => {
    const subscriptions = [
      client.on('fs:read', msg => setDocuments(previous => {
        const old = previous[msg.path];
        if (!old) return previous;
        if (old.loaded && old.content !== old.saved) return { ...previous, [msg.path]: { ...old, conflict: old.saved !== msg.content } };
        return { ...previous, [msg.path]: { content: msg.content, saved: msg.content, conflict: false, loaded: true } };
      })),
      client.on('fs:saved', msg => { setError(''); setDocuments(previous => previous[msg.path] ? { ...previous, [msg.path]: { ...previous[msg.path], saved: msg.content, conflict: false } } : previous); }),
      client.on('fs:error', msg => setError(`${msg.path}: ${msg.message}`)),
      client.on('fs:watch-event', msg => {
        const doc = docs.current[msg.path];
        if (!doc) return;
        if (doc.content !== doc.saved) setDocuments(previous => ({ ...previous, [msg.path]: { ...previous[msg.path], conflict: true } }));
        else if (msg.kind !== 'unlink' && !isBinaryDatabase(msg.path)) client.send({ type: 'fs:read', path: msg.path });
      }),
      client.on('fs:updated', msg => {
        if (msg.operation === 'create') return;
        setDocuments(previous => {
          const next = { ...previous };
          for (const name of Object.keys(previous)) {
            if (name !== msg.path && !name.startsWith(msg.path + '/')) continue;
            if (msg.destination) {
              const destination = msg.destination + name.slice(msg.path.length);
              next[destination] = previous[name];
              setActive(current => current === name ? destination : current);
              delete next[name];
            } else next[name] = { ...previous[name], conflict: true };
          }
          return next;
        });
      }),
    ];
    const status = client.onStatusChange?.(value => {
      if (value === 'open') for (const name of Object.keys(docs.current)) if (!isBinaryDatabase(name)) client.send({ type: 'fs:read', path: name });
    });
    return () => { subscriptions.forEach(unsubscribe => unsubscribe()); status?.(); };
  }, [client]);
  useEffect(() => {
    if (!path) return;
    setActive(path);
    if (!docs.current[path]) {
      const skipTextRead = isBinaryDatabase(path);
      setDocuments(previous => ({ ...previous, [path]: { content: '', saved: '', conflict: false, loaded: skipTextRead } }));
      if (!skipTextRead) client.send({ type: 'fs:read', path });
    }
  }, [client, path, openVersion]);
  const save = () => {
    if (activeRegistration?.readOnly || isBinaryDatabase(active)) return;
    if (active && documents[active]?.loaded) client.send({ type: 'fs:write', path: active, content: documents[active].content });
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); save(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const doc = active ? documents[active] : undefined;
  return <div className="editor-pane">
    <div className="pane-toolbar" role="tablist" aria-label="Open files">
      {Object.entries(documents).map(([name, item]) => <span key={name} className="editor-tab">
        <button role="tab" aria-selected={active === name} onClick={() => setActive(name)}>{name}{item.content !== item.saved ? ' •' : ''}</button>
        <button aria-label={`Close ${name}`} onClick={() => {
          if (item.content !== item.saved && !window.confirm(`Discard unsaved changes in ${name}?`)) return;
          const next = { ...documents }; delete next[name]; setDocuments(next);
          if (active === name) setActive(Object.keys(next).at(-1) ?? null);
        }}>×</button>
      </span>)}
      <button onClick={save} disabled={!doc?.loaded || !!activeRegistration?.readOnly || isBinaryDatabase(active)}>Save</button>
    </div>
    {error && <div role="alert" className="editor-conflict">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {doc?.conflict && <div role="alert" className="editor-conflict">file changed on disk — reload or keep mine?
      <button onClick={() => {
        if (!active) return;
        if (isBinaryDatabase(active)) {
          const next = { ...documents }; delete next[active]; setDocuments(next); setActive(null); return;
        }
        setDocuments(previous => ({ ...previous, [active]: { ...previous[active], saved: previous[active].content, conflict: false } }));
        client.send({ type: 'fs:read', path: active });
      }}>Reload</button>
      <button onClick={() => active && setDocuments(previous => ({ ...previous, [active]: { ...previous[active], conflict: false } }))}>Keep mine</button>
    </div>}
    {Object.entries(documents).map(([name, item]) => <DocumentEditor key={name} path={name} content={item.content} loaded={item.loaded} theme={theme} active={active === name} onChange={content => setDocuments(previous => previous[name] ? { ...previous, [name]: { ...previous[name], content } } : previous)} />)}
    {(!active || !doc?.loaded) && !activeRegistration && <div className="editor-empty">{active ? 'Loading file…' : 'Select a file to start editing'}</div>}
  </div>;
}

function DocumentEditor({ path, content, loaded, theme, active, onChange }: { path: string; content: string; loaded: boolean; theme: Theme; active: boolean; onChange: (value: string) => void }) {
  const registration = usePluginEditor(path);
  const PluginEditor = registration?.component;
  const binaryDatabase = isBinaryDatabase(path);
  const { workspaceId } = usePlugins();
  const [raw, setRaw] = useState(false);
  if ((!PluginEditor || raw || !loaded) && !active) return null;
  if (!PluginEditor && !loaded) return null;
  return <div hidden={!active} className="document-editor">
    {PluginEditor && registration?.allowTextFallback !== false && <div className="document-view-toolbar"><button onClick={() => setRaw(!raw)}>{raw ? 'Open plugin editor' : 'Open as text'}</button></div>}
    {binaryDatabase && !PluginEditor ? <div className="editor-empty">Enable the matching data plugin to inspect this binary file safely.</div> : PluginEditor && !raw ? <PluginBoundary onRaw={() => setRaw(true)}><PluginEditor workspaceId={workspaceId} path={path} content={content} theme={theme} onChange={onChange} /></PluginBoundary> :
      <div className="editor-monaco-wrapper"><MonacoEditor path={path} theme={theme === 'dark' ? 'vs-dark' : 'vs'} value={content} options={{ automaticLayout: true }} onChange={value => onChange(value ?? '')} /></div>}
  </div>;
}

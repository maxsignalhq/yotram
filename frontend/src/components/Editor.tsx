import { useEffect, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';

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

export function Editor({ client, path, theme = 'dark' }: { client: WsClient; path: string | null; theme?: Theme }) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [conflict, setConflict] = useState(false);

  // Refs mirror the latest state so the fs:watch-event handler (registered once
  // per path in the effect below) never reads stale closed-over values.
  const contentRef = useRef(content);
  const savedContentRef = useRef(savedContent);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { savedContentRef.current = savedContent; }, [savedContent]);

  useEffect(() => {
    if (!path) return;
    const unsubRead = client.on('fs:read', (msg) => {
      if (msg.path === path) {
        setContent(msg.content);
        setSavedContent(msg.content);
        setConflict(false);
      }
    });
    const unsubWatch = client.on('fs:watch-event', (msg) => {
      if (msg.path === path && msg.kind === 'change' && contentRef.current !== savedContentRef.current) {
        setConflict(true);
      }
    });
    client.send({ type: 'fs:read', path });
    return () => { unsubRead(); unsubWatch(); };
  }, [client, path]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (path) {
          client.send({ type: 'fs:write', path, content });
          setSavedContent(content);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [client, path, content]);

  if (!path) return <div className="editor-pane editor-empty">No file open</div>;

  return (
    <div className="editor-pane">
      {conflict && (
        <div role="alert" className="editor-conflict">
          file changed on disk — reload or keep mine?
          <button onClick={() => { client.send({ type: 'fs:read', path }); setConflict(false); }}>Reload</button>
          <button onClick={() => setConflict(false)}>Keep mine</button>
        </div>
      )}
      <div className="editor-monaco-wrapper">
        <MonacoEditor
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={(value: string | undefined) => setContent(value ?? '')}
        />
      </div>
    </div>
  );
}

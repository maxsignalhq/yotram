import { useEffect, useState } from 'react';
import { WsClient } from './wsClient';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { Dashboard, type Workspace } from './components/Dashboard';
import { Preview } from './components/Preview';
import { useTheme } from './theme';

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  return workspace ? <WorkspaceIDE key={workspace.id} workspace={workspace} onLeave={() => setWorkspace(null)} /> : <Dashboard onOpen={setWorkspace} />;
}

function WorkspaceIDE({ workspace, onLeave }: { workspace: Workspace; onLeave: () => void }) {
  const [theme, toggleTheme] = useTheme();
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [openVersion, setOpenVersion] = useState(0);
  const [openPath, setOpenPath] = useState<string | null>(null);
  // Tracks whether the socket has completed its first open, so the panes
  // (which send messages as soon as they mount) aren't mounted while the
  // underlying WebSocket is still in CONNECTING state.
  const [ready, setReady] = useState(false);

  const [client, setClient] = useState<WsClient | null>(null);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminals, setTerminals] = useState<string[]>([]);
  const [activeTerminal, setActiveTerminal] = useState('main');
  useEffect(() => {
    const c = new WsClient(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/?workspace=${encodeURIComponent(workspace.id)}`);
    c.onStatusChange((s) => {
      setStatus(s);
      if (s === 'open') setReady(true);
      if (s === 'closed') {
        // Re-register the folder if the local server restarted and lost its registry.
        void fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspace.path }) }).catch(() => {});
      }
    });
    setClient(c);
    return () => c.close();
  }, [workspace.id, workspace.path]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!client) return <div className="app-onboarding" role="status">Opening workspace…</div>;

  return (
    <div className="workspace-view">
      <header className="workspace-header"><button onClick={() => {
        if (window.confirm(dirty ? 'Discard unsaved edits and close this workspace’s terminals?' : 'Close this workspace’s terminals and return to projects? Saved files will stay on disk.')) onLeave();
      }}>Projects</button><strong>{workspace.name}</strong><span title={workspace.path}>{workspace.path}</span><button aria-label={terminalVisible ? 'Hide terminal' : 'Open terminal'} aria-pressed={terminalVisible} onClick={() => {
        if (!terminalVisible && terminals.length === 0) { setTerminals(['main']); setActiveTerminal('main'); }
        setTerminalVisible(value => !value);
      }}>Terminal</button><button aria-pressed={preview} onClick={() => setPreview(value => !value)}>Preview</button><button onClick={() => {
        void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.reload());
      }}>Log out</button></header>
      <div className={`app-shell${terminalVisible ? '' : ' without-terminal'}${preview ? ' with-preview' : ''}`}>
      {status !== 'open' && (
        <div role="status" className="reconnect-banner">
          reconnecting...
        </div>
      )}
      {ready && (
        <>
          <FileTree client={client} onOpenFile={path => { setOpenPath(path); setOpenVersion(value => value + 1); }} theme={theme} onToggleTheme={toggleTheme} />
          <Editor client={client} path={openPath} openVersion={openVersion} theme={theme} onDirtyChange={setDirty} />
          {preview && <Preview />}
          {terminals.length > 0 && <section className="terminal-section" hidden={!terminalVisible}>
            <div className="pane-toolbar">
              {terminals.map(id => <span key={id}><button onClick={() => setActiveTerminal(id)} aria-pressed={activeTerminal === id}>{id === 'main' ? 'Terminal' : `Shell ${terminals.indexOf(id) + 1}`}</button><button aria-label={`Close terminal ${id}`} onClick={() => {
                setTerminals(current => current.filter(value => value !== id));
                if (terminals.length === 1) setTerminalVisible(false);
                if (activeTerminal === id) setActiveTerminal(terminals.find(value => value !== id) ?? '');
              }}>×</button></span>)}
              <button aria-label="New terminal" onClick={() => { const id = crypto.randomUUID(); setTerminals(current => [...current, id]); setActiveTerminal(id); }}>+</button>
            </div>
            {terminals.map(id => <div key={id} className="terminal-container" hidden={id !== activeTerminal}><Terminal client={client} sessionId={id} theme={theme} /></div>)}
          </section>}
        </>
      )}
    </div></div>
  );
}

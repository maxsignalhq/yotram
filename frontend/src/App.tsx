import { useEffect, useRef, useState } from 'react';
import { WsClient } from './wsClient';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { Dashboard, type Workspace } from './components/Dashboard';
import { WorkflowPanel } from './components/WorkflowPanel';
import { Preview } from './components/Preview';
import { useTheme } from './theme';
import { getPermissionState, requestNotificationPermission, notifyProcessExit, type PermissionState } from './notifications';

function terminalId(): string { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  return workspace ? <WorkspaceIDE key={workspace.id} workspace={workspace} onLeave={() => setWorkspace(null)} onOpenWorkspace={setWorkspace} /> : <Dashboard onOpen={setWorkspace} />;
}

function WorkspaceIDE({ workspace, onLeave, onOpenWorkspace }: { workspace: Workspace; onLeave: () => void; onOpenWorkspace: (w: Workspace) => void }) {
  const [theme, toggleTheme] = useTheme();
  const [preview, setPreview] = useState(false);
  const [previewPort, setPreviewPort] = useState<number | undefined>();
  const [workflow, setWorkflow] = useState(false);
  const [recap, setRecap] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${workspace.id}/activity`).then(response => response.json()).then(record => {
      if (cancelled || !Array.isArray(record.events)) return;
      let lastRead = 0; try { lastRead = Number(localStorage.getItem(`yotram.read.${workspace.id}`) ?? 0); } catch { /* browser storage unavailable */ }
      const events = record.events.filter((e: { at: number }) => e.at > lastRead);
      if (events.length) setRecap(`${events.length} updates since your last read · ${events.filter((e: { kind: string }) => e.kind === 'file').length} file changes`);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspace.id]);
  const [agents, setAgents] = useState({ claude: false, codex: false });
  const commands = useRef<Record<string, string>>({});
  useEffect(() => { fetch('/api/agents').then(r => r.json()).then(value => setAgents({ claude: value.claude === true, codex: value.codex === true })).catch(() => {}); }, []);
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
  const [notifyPermission, setNotifyPermission] = useState<PermissionState>(() => getPermissionState());
  // Mirrors `terminals` for the pty:exit handler below, which must read the
  // *current* list without making the subscription effect depend on
  // `terminals` (that would re-subscribe on every terminal add/remove).
  const terminalsRef = useRef(terminals);
  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => {
    const c = new WsClient(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/?workspace=${encodeURIComponent(workspace.id)}`);
    c.onStatusChange((s) => {
      setStatus(s);
      if (s === 'open') { setReady(true); c.send({ type: 'pty:list' }); }
      if (s === 'closed') {
        // Re-register the folder if the local server restarted and lost its registry.
        void fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspace.path }) }).catch(() => {});
      }
    });
    c.on('pty:list', message => {
      setTerminals(message.sessions.map(session => session.id));
      setActiveTerminal(current => message.sessions.some(s => s.id === current) ? current : message.sessions[0]?.id ?? '');
      if (message.sessions.length) setTerminalVisible(true);
    });
    c.on('pty:signal', message => { if (document.visibilityState !== 'visible' && message.kind === 'complete') notifyProcessExit('Command', Number(message.value)); });
    c.on('pty:ready', message => { delete commands.current[message.sessionId]; });
    setClient(c);
    return () => c.close();
  }, [workspace.id, workspace.path]);

  useEffect(() => {
    if (!client) return;
    return client.on('pty:exit', msg => {
      if (document.visibilityState !== 'visible') {
        const label = msg.sessionId === 'main' ? 'Terminal' : `Shell ${terminalsRef.current.indexOf(msg.sessionId) + 1}`;
        notifyProcessExit(label, msg.exitCode);
      }
    });
  }, [client]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!client) return <div className="app-onboarding" role="status">Opening workspace…</div>;

  function resumeInNewTerminal(command: string) {
    if (!client) return;
    const id = terminalId();
    setTerminals(current => [...current, id]);
    setActiveTerminal(id);
    setTerminalVisible(true);
    commands.current[id] = command.trim();
  }

  return (
    <div className="workspace-view">
      <header className="workspace-header"><button onClick={() => {
        if (window.confirm(dirty ? 'Discard unsaved edits and return to projects? Terminals will keep running.' : 'Return to projects? Terminals will keep running.')) onLeave();
      }}>Projects</button><strong>{workspace.name}</strong><span title={workspace.path}>{workspace.path}</span><button aria-label={terminalVisible ? 'Hide terminal' : 'Open terminal'} aria-pressed={terminalVisible} onClick={() => {
        if (!terminalVisible && terminals.length === 0) { setTerminals(['main']); setActiveTerminal('main'); }
        setTerminalVisible(value => !value);
      }}>Terminal</button><button aria-pressed={preview} onClick={() => setPreview(value => !value)}>Preview</button><button onClick={() => { setWorkflow(value => !value); setRecap(''); }} aria-label="Workspace tools" aria-pressed={workflow}>Workspace tools</button>{agents.claude && <button onClick={() => resumeInNewTerminal('claude')}>Start Claude</button>}{agents.codex && <button onClick={() => resumeInNewTerminal('codex')}>Start Codex</button>}<button
        aria-label={notifyPermission === 'granted' ? 'Notifications on' : notifyPermission === 'denied' ? 'Notifications blocked by browser' : 'Enable notifications'}
        aria-pressed={notifyPermission === 'granted'}
        disabled={notifyPermission === 'denied'}
        title={notifyPermission === 'denied' ? 'Notifications are blocked in your browser settings' : undefined}
        onClick={() => { void requestNotificationPermission().then(setNotifyPermission); }}
      >🔔</button><button onClick={() => {
        void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.reload());
      }}>Log out</button></header>
      {recap && <button className="recap-banner" onClick={() => { setWorkflow(true); setRecap(''); }}>While you were away: {recap}. Review activity →</button>}
      <div className={`app-shell${terminalVisible ? '' : ' without-terminal'}${preview ? ' with-preview' : ''}`}>
      {status !== 'open' && (
        <div role="status" className="reconnect-banner">
          reconnecting...
        </div>
      )}
      {ready && (
        <>
          <Sidebar client={client} onOpenFile={path => { setOpenPath(path); setOpenVersion(value => value + 1); }} theme={theme} onToggleTheme={toggleTheme} workspacePath={workspace.path} onResumeSession={resumeInNewTerminal} />
          <Editor client={client} path={openPath} openVersion={openVersion} theme={theme} onDirtyChange={setDirty} />
          {preview && <Preview workspaceId={workspace.id} initialPort={previewPort} onPortChange={setPreviewPort} />}
          {workflow && <WorkflowPanel workspace={workspace} currentFile={openPath} currentSession={activeTerminal} previewPort={previewPort} onClose={() => setWorkflow(false)} onRun={resumeInNewTerminal} onFile={file => { setOpenPath(file); setOpenVersion(v => v + 1); }} onPreview={port => { setPreviewPort(port); setPreview(true); setWorkflow(false); }} onSession={id => { if (!terminals.includes(id)) setTerminals(values => [...values, id]); setActiveTerminal(id); setTerminalVisible(true); client.send({ type: 'pty:ack', sessionId: id }); }} onOpenWorkspace={w => { if (!dirty || window.confirm('Discard unsaved editor changes and open the experiment?')) onOpenWorkspace(w); }} />}
          {terminals.length > 0 && <section className="terminal-section" hidden={!terminalVisible}>
            <div className="pane-toolbar">
              {terminals.map(id => <span key={id}><button onClick={() => setActiveTerminal(id)} aria-pressed={activeTerminal === id}>{id === 'main' ? 'Terminal' : `Shell ${terminals.indexOf(id) + 1}`}</button><button aria-label={`Close terminal ${id}`} onClick={() => {
                if (!window.confirm('Stop this terminal and its running command?')) return;
                client.send({ type: 'pty:kill', sessionId: id });
                setTerminals(current => current.filter(value => value !== id));
                if (terminals.length === 1) setTerminalVisible(false);
                if (activeTerminal === id) setActiveTerminal(terminals.find(value => value !== id) ?? '');
              }}>×</button></span>)}
              <button aria-label="New terminal" onClick={() => { const id = terminalId(); setTerminals(current => [...current, id]); setActiveTerminal(id); }}>+</button>
            </div>
            {terminals.map(id => <div key={id} className="terminal-container" hidden={id !== activeTerminal}><Terminal client={client} sessionId={id} theme={theme} command={commands.current[id]} /></div>)}
          </section>}
        </>
      )}
    </div></div>
  );
}

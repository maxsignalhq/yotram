import { useEffect, useRef, useState } from 'react';
import { WsClient, type ViewState } from './wsClient';
import { ResizablePanels } from './components/ResizablePanels';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { Dashboard, type Workspace } from './components/Dashboard';
import { WorkflowPanel } from './components/WorkflowPanel';
import { Preview } from './components/Preview';
import { useTheme } from './theme';
import { PluginProvider, PluginsMenu } from './plugins/PluginProvider';
import { GitHistoryPanel } from './plugins/git-history/GitHistoryPanel';
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
  const [pluginPanel, setPluginPanel] = useState<'git-history' | null>(null);
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
  const [viewState, setViewState] = useState<ViewState | null>(null);
  const viewStateAppliedRef = useRef(false);
  // The restored active terminal, held until pty:list reports it live. The
  // server answers pty:list before view:state, so either message can be last.
  const pendingTerminalRef = useRef<string | null>(null);
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
      if (s === 'open') { setReady(true); c.send({ type: 'pty:list' }); c.send({ type: 'view:get' }); }
      if (s === 'closed') {
        // Re-register the folder if the local server restarted and lost its registry.
        void fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspace.path }) }).catch(() => {});
      }
    });
    c.on('pty:list', message => {
      const ids = message.sessions.map(session => session.id);
      terminalsRef.current = ids;
      setTerminals(ids);
      const restored = pendingTerminalRef.current;
      if (restored && ids.includes(restored)) pendingTerminalRef.current = null;
      setActiveTerminal(current => {
        if (restored && ids.includes(restored)) return restored;
        return ids.includes(current) ? current : ids[0] ?? '';
      });
      if (message.sessions.length) setTerminalVisible(true);
    });
    c.on('view:state', message => {
      setViewState(message.state);
      if (viewStateAppliedRef.current) return;
      viewStateAppliedRef.current = true;
      if (message.state.terminalVisible) setTerminalVisible(true);
      const restored = message.state.activeTerminal;
      if (restored) {
        if (terminalsRef.current.includes(restored)) setActiveTerminal(restored);
        else pendingTerminalRef.current = restored;
      }
      if (message.state.preview) { setPreview(true); if (message.state.previewPort) setPreviewPort(message.state.previewPort); }
    });
    c.on('pty:signal', message => { if (document.visibilityState !== 'visible' && message.kind === 'complete') notifyProcessExit('Command', Number(message.value)); });
    c.on('pty:ready', message => { delete commands.current[message.sessionId]; });
    setClient(c);
    return () => c.close();
  }, [workspace.id, workspace.path]);

  useEffect(() => {
    if (!client || !viewStateAppliedRef.current) return;
    const timer = setTimeout(() => {
      client.send({ type: 'view:update', patch: { terminalVisible, activeTerminal, preview, previewPort } });
    }, 500);
    return () => clearTimeout(timer);
  }, [client, terminalVisible, activeTerminal, preview, previewPort]);

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
    <PluginProvider workspaceId={workspace.id}><div className="workspace-view">
      <header className="workspace-header">
        <div className="workspace-header-left">
          <button className="button-ghost" onClick={() => {
            if (window.confirm(dirty ? 'Discard unsaved edits and return to projects? Terminals will keep running.' : 'Return to projects? Terminals will keep running.')) onLeave();
          }}>Projects</button>
          <strong className="workspace-name">{workspace.name}</strong>
          <span className="workspace-path" title={workspace.path}>{workspace.path}</span>
        </div>
        <div className="workspace-header-center header-segment">
          <button aria-label={terminalVisible ? 'Hide terminal' : 'Open terminal'} aria-pressed={terminalVisible} onClick={() => {
            if (!terminalVisible && terminals.length === 0) { setTerminals(['main']); setActiveTerminal('main'); }
            setTerminalVisible(value => !value);
          }}>Terminal</button>
          <button aria-pressed={preview} onClick={() => setPreview(value => !value)}>Preview</button>
          <button onClick={() => { setWorkflow(value => !value); setRecap(''); }} aria-label="Workspace tools" aria-pressed={workflow}>Workspace tools</button>
          <PluginsMenu openFile={path => { setOpenPath(path); setOpenVersion(value => value + 1); }} openPanel={setPluginPanel} />
        </div>
        <div className="workspace-header-right">
          {agents.claude && <button onClick={() => resumeInNewTerminal('claude')}>Start Claude</button>}
          {agents.codex && <button onClick={() => resumeInNewTerminal('codex')}>Start Codex</button>}
          <button
            className="button-icon"
            aria-label={notifyPermission === 'granted' ? 'Notifications on' : notifyPermission === 'denied' ? 'Notifications blocked by browser' : 'Enable notifications'}
            aria-pressed={notifyPermission === 'granted'}
            disabled={notifyPermission === 'denied'}
            title={notifyPermission === 'denied' ? 'Notifications are blocked in your browser settings' : undefined}
            onClick={() => { void requestNotificationPermission().then(setNotifyPermission); }}
          >🔔</button>
          <button className="button-ghost" onClick={() => {
            void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.reload());
          }}>Log out</button>
        </div>
      </header>
      {recap && <button className="recap-banner" onClick={() => { setWorkflow(true); setRecap(''); }}>While you were away: {recap}. Review activity →</button>}
      <ResizablePanels workspaceId={workspace.id} preview={preview} terminalVisible={terminalVisible}>
      {status !== 'open' && (
        <div role="status" className="reconnect-banner">
          reconnecting...
        </div>
      )}
      {ready && (
        <>
          <Sidebar client={client} onOpenFile={path => { setOpenPath(path); setOpenVersion(value => value + 1); }} theme={theme} onToggleTheme={toggleTheme} workspacePath={workspace.path} onResumeSession={resumeInNewTerminal} initialTab={viewState?.sidebarTab} />
          <Editor client={client} path={openPath} openVersion={openVersion} theme={theme} onDirtyChange={setDirty} initialOpenFiles={viewState?.openFiles} initialActiveFile={viewState?.activeFile} initialEditorState={viewState?.editorState} />
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
    </ResizablePanels>
    {pluginPanel === 'git-history' && <GitHistoryPanel workspaceId={workspace.id} theme={theme} onClose={() => setPluginPanel(null)} />}
    </div></PluginProvider>
  );
}

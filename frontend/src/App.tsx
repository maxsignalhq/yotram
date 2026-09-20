import { useMemo, useState } from 'react';
import { WsClient } from './wsClient';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { useTheme } from './theme';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [openPath, setOpenPath] = useState<string | null>(null);
  // Tracks whether the socket has completed its first open, so the panes
  // (which send messages as soon as they mount) aren't mounted while the
  // underlying WebSocket is still in CONNECTING state.
  const [ready, setReady] = useState(false);

  const client = useMemo(() => {
    if (!connected) return null;
    const c = new WsClient(`ws://${window.location.host}`);
    c.onStatusChange((s) => {
      setStatus(s);
      if (s === 'open') setReady(true);
    });
    return c;
  }, [connected]);

  if (!client) {
    return (
      <div className="app-onboarding">
        <h1>Open a project</h1>
        <button className="button-primary" onClick={() => setConnected(true)}>
          Open current directory
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {status !== 'open' && (
        <div role="status" className="reconnect-banner">
          reconnecting...
        </div>
      )}
      {ready && (
        <>
          <FileTree client={client} onOpenFile={setOpenPath} theme={theme} onToggleTheme={toggleTheme} />
          <Editor client={client} path={openPath} theme={theme} />
          <Terminal client={client} sessionId="main" theme={theme} />
        </>
      )}
    </div>
  );
}

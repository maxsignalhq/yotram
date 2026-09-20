import { useMemo, useState } from 'react';
import { WsClient } from './wsClient';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [openPath, setOpenPath] = useState<string | null>(null);

  const client = useMemo(() => {
    if (!connected) return null;
    const c = new WsClient(`ws://${window.location.host}`);
    c.onStatusChange(setStatus);
    return c;
  }, [connected]);

  if (!client) {
    return (
      <div>
        <h1>Open a project</h1>
        <button onClick={() => setConnected(true)}>Open current directory</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr', height: '100vh' }}>
      {status !== 'open' && <div role="status">reconnecting...</div>}
      <FileTree client={client} onOpenFile={setOpenPath} />
      <Editor client={client} path={openPath} />
      <Terminal client={client} sessionId="main" />
    </div>
  );
}

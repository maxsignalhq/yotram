import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import 'xterm/css/xterm.css';
import { FitAddon } from 'xterm-addon-fit';
import type { WsClient } from '../wsClient';

export function Terminal({ client, sessionId }: { client: WsClient; sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new XTerm();
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) term.open(containerRef.current);
    fitAddon.fit();

    client.send({ type: 'pty:create', sessionId, cols: term.cols, rows: term.rows });

    let exited = false;

    const unsubData = client.on('pty:data', (msg) => {
      if (msg.sessionId === sessionId) term.write(msg.data);
    });
    const unsubExit = client.on('pty:exit', (msg) => {
      if (msg.sessionId === sessionId) {
        exited = true;
        term.write(`\r\nprocess exited (code ${msg.exitCode})\r\n`);
      }
    });
    term.onData((data: string) => {
      if (exited) return;
      client.send({ type: 'pty:data', sessionId, data });
    });

    return () => {
      unsubData();
      unsubExit();
      term.dispose();
    };
  }, [client, sessionId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

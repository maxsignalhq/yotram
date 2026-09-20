import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import 'xterm/css/xterm.css';
import { FitAddon } from 'xterm-addon-fit';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';

const XTERM_THEMES: Record<Theme, { background: string; foreground: string; cursor: string }> = {
  dark: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc' },
  light: { background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e' },
};

export function Terminal({ client, sessionId, theme = 'dark' }: { client: WsClient; sessionId: string; theme?: Theme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    const term = new XTerm({ theme: XTERM_THEMES[theme] });
    termRef.current = term;
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
      termRef.current = null;
    };
    // `theme` is intentionally not a dependency here: recreating the terminal
    // on every toggle would re-issue `pty:create` for the same sessionId and
    // orphan the running shell. Theme changes are applied live below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId]);

  useEffect(() => {
    if (termRef.current?.options) {
      termRef.current.options.theme = XTERM_THEMES[theme];
    }
  }, [theme]);

  return <div ref={containerRef} className="terminal-pane" />;
}

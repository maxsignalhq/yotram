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

export function Terminal({ client, sessionId, theme = 'dark', command }: { client: WsClient; sessionId: string; theme?: Theme; command?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const commandRef = useRef(command);

  useEffect(() => {
    const term = new XTerm({ theme: XTERM_THEMES[theme] });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) term.open(containerRef.current);
    fitAddon.fit();

    let exited = false;
    let attached = false;
    const unsubReady = client.on('pty:ready', msg => {
      if (msg.sessionId !== sessionId) return;
      term.reset?.(); term.write(msg.output); attached = true;
      exited = msg.exitCode !== undefined;
      if (exited) term.write(`\r\nShell exited (${msg.exitCode}). Start a new terminal to continue.\r\n`);
      commandRef.current = undefined;
    });
    const unsubError = client.on('pty:error', msg => { if (msg.sessionId === sessionId) term.write(`\r\n${msg.message}\r\n`); });
    const unsubscribeStatus = client.onStatusChange?.(status => {
      if (status === 'closed') { attached = false; term.write('\r\nDisconnected. Shell continues on the server.\r\n'); }
      if (status === 'open') { exited = false; client.send({ type: 'pty:create', sessionId, cols: term.cols, rows: term.rows }); }
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (!containerRef.current?.clientWidth) return;
      fitAddon.fit();
      client.send({ type: 'pty:resize', sessionId, cols: term.cols, rows: term.rows });
    });
    if (containerRef.current) observer?.observe(containerRef.current);


    const unsubData = client.on('pty:data', (msg) => {
      if (msg.sessionId === sessionId && attached) term.write(msg.data);
    });
    const unsubExit = client.on('pty:exit', (msg) => {
      if (msg.sessionId === sessionId) {
        exited = true;
        term.write(`\r\nprocess exited (code ${msg.exitCode})\r\n`);
      }
    });
    term.onData((data: string) => {
      if (exited || !attached) return;
      client.send({ type: 'pty:data', sessionId, data });
    });

    client.send({ type: 'pty:create', sessionId, cols: term.cols, rows: term.rows, ...(commandRef.current ? { command: commandRef.current } : {}) });

    return () => {
      observer?.disconnect();
      unsubscribeStatus?.();
      unsubReady(); unsubError();
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

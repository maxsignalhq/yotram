import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Terminal } from '../src/components/Terminal';
import type { WsClient, ServerMessage } from '../src/wsClient';

const writeSpy = vi.fn();
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    onData: vi.fn(),
    write: writeSpy,
    loadAddon: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
}));

function fakeClient() {
  const handlers = new Map<string, ((msg: ServerMessage) => void)[]>();
  return {
    send: vi.fn(),
    on: vi.fn((type: string, handler: (msg: ServerMessage) => void) => {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {};
    }),
    emit: (msg: ServerMessage) => {
      for (const h of handlers.get(msg.type) ?? []) h(msg);
    },
  };
}

describe('Terminal', () => {
  it('sends pty:create on mount', () => {
    const client = fakeClient();
    render(<Terminal client={client as unknown as WsClient} sessionId="s1" />);
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pty:create', sessionId: 's1' }),
    );
  });

  it('detaches on unmount without killing the server-owned shell', () => {
    const client = fakeClient(); const result = render(<Terminal client={client as unknown as WsClient} sessionId="s2" />);
    result.unmount(); expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pty:kill' }));
  });

  it('writes incoming pty:data to the terminal', () => {
    const client = fakeClient();
    render(<Terminal client={client as unknown as WsClient} sessionId="s1" />);
    client.emit({ type: 'pty:ready', sessionId: 's1', output: 'restored' });
    client.emit({ type: 'pty:data', sessionId: 's1', data: 'hello' });
    expect(writeSpy).toHaveBeenCalledWith('hello');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { FileTree } from '../src/components/FileTree';
import type { WsClient, ServerMessage } from '../src/wsClient';

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

describe('FileTree', () => {
  afterEach(() => cleanup());

  it('requests a listing on mount and renders entries', () => {
    const client = fakeClient();
    render(<FileTree client={client as unknown as WsClient} onOpenFile={() => {}} />);
    expect(client.send).toHaveBeenCalledWith({ type: 'fs:list', path: '.' });
    act(() => client.emit({ type: 'fs:list', path: '.', entries: [{ name: 'a.txt', isDirectory: false }] }));
    expect(screen.getByText('a.txt')).toBeTruthy();
  });

  it('calls onOpenFile when a file entry is clicked', () => {
    const client = fakeClient();
    const onOpenFile = vi.fn();
    render(<FileTree client={client as unknown as WsClient} onOpenFile={onOpenFile} />);
    act(() => client.emit({ type: 'fs:list', path: '.', entries: [{ name: 'a.txt', isDirectory: false }] }));
    fireEvent.click(screen.getByText('a.txt'));
    expect(onOpenFile).toHaveBeenCalledWith('a.txt');
  });
});

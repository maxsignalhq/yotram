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

afterEach(() => cleanup());

describe('FileTree', () => {

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

function setupDragTree() {
  const client = fakeClient();
  render(<FileTree client={client as unknown as WsClient} onOpenFile={() => {}} />);
  act(() => client.emit({ type: 'fs:list', path: '.', entries: [
    { name: 'a.txt', isDirectory: false }, { name: 'src', isDirectory: true },
  ] }));
  return client;
}
const transfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });

it('moves a file into a folder and reveals it after server confirmation', () => {
  const client = setupDragTree();
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByText('a.txt'), { dataTransfer });
  fireEvent.dragOver(screen.getByText('▸ src'), { dataTransfer });
  expect(dataTransfer.dropEffect).toBe('move');
  fireEvent.drop(screen.getByText('▸ src'), { dataTransfer });
  expect(client.send).toHaveBeenCalledWith({ type: 'fs:rename', path: 'a.txt', destination: 'src/a.txt' });
  act(() => client.emit({ type: 'fs:updated', path: 'a.txt', destination: 'src/a.txt', operation: 'rename' }));
  expect(client.send).toHaveBeenCalledWith({ type: 'fs:list', path: 'src' });
  expect(screen.getByText('▾ src')).toBeTruthy();
});

it('ignores external drags, same-location drops, and drops into descendants', () => {
  const client = setupDragTree();
  const dataTransfer = transfer();
  fireEvent.drop(screen.getByText('▸ src'), { dataTransfer });
  fireEvent.dragStart(screen.getByText('a.txt'), { dataTransfer });
  fireEvent.drop(screen.getByText('Project root'), { dataTransfer });
  fireEvent.click(screen.getByText('▸ src'));
  act(() => client.emit({ type: 'fs:list', path: 'src', entries: [{ name: 'child', isDirectory: true }] }));
  fireEvent.dragStart(screen.getByText('▾ src'), { dataTransfer });
  fireEvent.drop(screen.getByText('▸ child'), { dataTransfer });
  fireEvent.dragStart(screen.getByText('▾ src'), { dataTransfer });
  fireEvent.drop(screen.getByText('▾ src'), { dataTransfer });
  expect(client.send.mock.calls.filter(([message]) => message.type === 'fs:rename')).toEqual([]);
});

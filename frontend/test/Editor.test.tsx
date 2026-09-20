import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Editor } from '../src/components/Editor';
import type { WsClient, ServerMessage } from '../src/wsClient';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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
      // Wrapped in act() so React flushes the resulting state update/render
      // synchronously before the next assertion, matching how fireEvent behaves.
      act(() => {
        for (const h of handlers.get(msg.type) ?? []) h(msg);
      });
    },
  };
}

describe('Editor', () => {
  afterEach(() => cleanup());

  it('requests file content when path is set', () => {
    const client = fakeClient();
    render(<Editor client={client as unknown as WsClient} path="a.txt" />);
    expect(client.send).toHaveBeenCalledWith({ type: 'fs:read', path: 'a.txt' });
  });

  it('shows a conflict prompt on external change with unsaved edits', () => {
    const client = fakeClient();
    render(<Editor client={client as unknown as WsClient} path="a.txt" />);
    client.emit({ type: 'fs:read', path: 'a.txt', content: 'original' });
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'edited' } });
    client.emit({ type: 'fs:watch-event', path: 'a.txt', kind: 'change' });
    expect(screen.getByText(/file changed on disk/i)).toBeTruthy();
  });
});

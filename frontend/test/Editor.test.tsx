import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Editor } from '../src/components/Editor';
import type { WsClient, ServerMessage } from '../src/wsClient';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  loader: { config: vi.fn() },
}));

// Editor.tsx imports the real `monaco-editor` package (to bundle it locally
// instead of loading it from a CDN — see loader.config below). Importing the
// real package executes DOM-touching module-init code (e.g. clipboard
// contributions call `document.queryCommandSupported`) that jsdom doesn't
// implement, and it's unnecessary anyway since `@monaco-editor/react` itself
// is stubbed out above.
vi.mock('monaco-editor', () => ({}));

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

it('preserves unsaved edits across tabs and only marks saved after acknowledgement', () => {
  const client = fakeClient();
  const { rerender } = render(<Editor client={client as unknown as WsClient} path="a.txt" />);
  client.emit({ type: 'fs:read', path: 'a.txt', content: 'original' });
  fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'edited' } });
  rerender(<Editor client={client as unknown as WsClient} path="b.txt" />);
  client.emit({ type: 'fs:read', path: 'b.txt', content: 'second' });
  fireEvent.click(screen.getByRole('tab', { name: 'a.txt •' }));
  expect((screen.getByTestId('monaco-stub') as HTMLTextAreaElement).value).toBe('edited');
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getByRole('tab', { name: 'a.txt •' })).toBeTruthy();
  client.emit({ type: 'fs:saved', path: 'a.txt', content: 'edited' });
  expect(screen.getByRole('tab', { name: 'a.txt' })).toBeTruthy();
  cleanup();
});

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Editor } from '../src/components/Editor';
import type { WsClient, ServerMessage } from '../src/wsClient';

const monacoHooks = vi.hoisted(() => ({ cursorListeners: [] as (() => void)[] }));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, onMount }: { value: string; onChange: (v: string) => void; onMount?: (editor: unknown) => void }) => (
    <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} ref={el => {
      if (el && !el.dataset.mounted) {
        el.dataset.mounted = '1';
        onMount?.({ restoreViewState: vi.fn(), saveViewState: () => ({ cursor: 42 }), onDidChangeCursorPosition: (cb: () => void) => monacoHooks.cursorListeners.push(cb), onDidScrollChange: vi.fn() });
      }
    }} />
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

  it('opens every file listed in initialOpenFiles and activates initialActiveFile on mount', () => {
    const client = fakeClient();
    render(<Editor client={client as unknown as WsClient} path={null} initialOpenFiles={['a.ts', 'b.ts']} initialActiveFile="b.ts" />);
    expect(client.send).toHaveBeenCalledWith({ type: 'fs:read', path: 'a.ts' });
    expect(client.send).toHaveBeenCalledWith({ type: 'fs:read', path: 'b.ts' });
    client.emit({ type: 'fs:read', path: 'b.ts', content: 'active content' });
    expect(screen.getByRole('tab', { name: /b\.ts/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('sends a debounced view:update patch when the open tabs or active file change', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    render(<Editor client={client as unknown as WsClient} path="a.ts" openVersion={1} />);
    client.emit({ type: 'fs:read', path: 'a.ts', content: 'hello' });
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(client.send).toHaveBeenCalledWith({ type: 'view:update', patch: expect.objectContaining({ openFiles: ['a.ts'], activeFile: 'a.ts' }) });
    vi.useRealTimers();
  });
  describe('review fixes', () => {
    const open = (client: ReturnType<typeof fakeClient>) => ({ client: client as unknown as WsClient, path: null });
    afterEach(() => { vi.useRealTimers(); monacoHooks.cursorListeners.length = 0; });

    it('keeps restored cursor state that arrives after mount in the next persisted patch', async () => {
      vi.useFakeTimers();
      const client = fakeClient();
      const { rerender } = render(<Editor {...open(client)} />);
      rerender(<Editor {...open(client)} initialOpenFiles={['a.ts']} initialActiveFile="a.ts" initialEditorState={{ 'a.ts': { cursor: 7 } }} />);
      client.emit({ type: 'fs:read', path: 'a.ts', content: 'x' });
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(client.send).toHaveBeenLastCalledWith({ type: 'view:update', patch: expect.objectContaining({ editorState: { 'a.ts': { cursor: 7 } } }) });
    });

    it('does not persist when a file is merely reloaded after a watch event', async () => {
      vi.useFakeTimers();
      const client = fakeClient();
      render(<Editor client={client as unknown as WsClient} path="a.ts" openVersion={1} />);
      client.emit({ type: 'fs:read', path: 'a.ts', content: 'v1' });
      await act(async () => { vi.advanceTimersByTime(1200); });
      client.send.mockClear();
      client.emit({ type: 'fs:watch-event', path: 'a.ts', kind: 'change' } as ServerMessage);
      client.emit({ type: 'fs:read', path: 'a.ts', content: 'v2' });
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'view:update' }));
    });

    it('persists a cursor move on its own', async () => {
      vi.useFakeTimers();
      const client = fakeClient();
      render(<Editor client={client as unknown as WsClient} path="a.ts" openVersion={1} />);
      client.emit({ type: 'fs:read', path: 'a.ts', content: 'v1' });
      await act(async () => { vi.advanceTimersByTime(1200); });
      client.send.mockClear();
      expect(monacoHooks.cursorListeners.length).toBeGreaterThan(0);
      act(() => { monacoHooks.cursorListeners.forEach(cb => cb()); });
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(client.send).toHaveBeenCalledWith({ type: 'view:update', patch: expect.objectContaining({ editorState: { 'a.ts': { cursor: 42 } } }) });
    });

    it('does not read binary database files as text when restoring tabs', () => {
      const client = fakeClient();
      render(<Editor {...open(client)} initialOpenFiles={['data.parquet', 'a.ts']} initialActiveFile="a.ts" />);
      expect(client.send).toHaveBeenCalledWith({ type: 'fs:read', path: 'a.ts' });
      expect(client.send).not.toHaveBeenCalledWith({ type: 'fs:read', path: 'data.parquet' });
    });

    it('does not inject tabs from a later view state once an empty one was already consumed', () => {
      const client = fakeClient();
      const { rerender } = render(<Editor {...open(client)} initialOpenFiles={[]} />);
      rerender(<Editor {...open(client)} initialOpenFiles={['a.ts']} initialActiveFile="a.ts" />);
      expect(client.send).not.toHaveBeenCalledWith({ type: 'fs:read', path: 'a.ts' });
    });
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

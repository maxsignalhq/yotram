// frontend/test/Sidebar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Sidebar } from '../src/components/Sidebar';
import type { WsClient, ServerMessage } from '../src/wsClient';

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  DiffEditor: () => null,
  loader: { config: vi.fn() },
}));
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
    emit: () => {},
  };
}

describe('Sidebar', () => {
  afterEach(() => cleanup());

  it('shows the file tree by default', () => {
    const client = fakeClient();
    render(<Sidebar client={client as unknown as WsClient} onOpenFile={() => {}} workspacePath="/tmp/demo" onResumeSession={() => {}} />);
    expect(client.send).toHaveBeenCalledWith({ type: 'fs:list', path: '.' });
    expect(client.send).not.toHaveBeenCalledWith({ type: 'git:status' });
  });

  it('switches to the Git tab and requests git status only once opened', () => {
    const client = fakeClient();
    render(<Sidebar client={client as unknown as WsClient} onOpenFile={() => {}} workspacePath="/tmp/demo" onResumeSession={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    expect(client.send).toHaveBeenCalledWith({ type: 'git:status' });
  });

  it('calls onToggleTheme when the theme toggle is clicked, and reflects the current theme in its label', () => {
    const client = fakeClient();
    const onToggleTheme = vi.fn();
    render(<Sidebar client={client as unknown as WsClient} onOpenFile={() => {}} theme="dark" onToggleTheme={onToggleTheme} workspacePath="/tmp/demo" onResumeSession={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('switches to the Sessions tab and fetches sessions for the workspace path only once opened', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const client = fakeClient();
    render(<Sidebar client={client as unknown as WsClient} onOpenFile={() => {}} workspacePath="/tmp/demo" onResumeSession={() => {}} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await screen.findByText('No past sessions found for this project.');
    expect(fetch).toHaveBeenCalledWith('/api/sessions?path=%2Ftmp%2Fdemo');
    vi.unstubAllGlobals();
  });

  it('re-fetches sessions every time the Sessions tab is reopened, not just the first time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const client = fakeClient();
    render(<Sidebar client={client as unknown as WsClient} onOpenFile={() => {}} workspacePath="/tmp/demo" onResumeSession={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await screen.findByText('No past sessions found for this project.');
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await screen.findByText('No past sessions found for this project.');
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { GitPanel } from '../src/components/GitPanel';
import type { WsClient, ServerMessage } from '../src/wsClient';

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="monaco-diff-stub">{original}|{modified}</div>
  ),
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
    emit: (msg: ServerMessage) => { act(() => { for (const h of handlers.get(msg.type) ?? []) h(msg); }); },
  };
}

describe('GitPanel', () => {
  afterEach(() => cleanup());

  it('requests status and branches on mount', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    expect(client.send).toHaveBeenCalledWith({ type: 'git:status' });
    expect(client.send).toHaveBeenCalledWith({ type: 'git:branches' });
  });

  it('shows a not-a-repo message', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: false, branch: null, staged: [], unstaged: [], untracked: [] });
    expect(screen.getByText("This folder isn't a git repository.")).toBeTruthy();
  });

  it('renders staged, unstaged, and untracked files, and stages a file on click', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: ['a.ts'], unstaged: ['b.ts'], untracked: ['c.ts'] });
    expect(screen.getByText('a.ts')).toBeTruthy();
    expect(screen.getByText('b.ts')).toBeTruthy();
    expect(screen.getByText('c.ts')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Stage b.ts'));
    expect(client.send).toHaveBeenCalledWith({ type: 'git:stage', path: 'b.ts' });
  });

  it('unstages a staged file on click', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: ['a.ts'], unstaged: [], untracked: [] });
    fireEvent.click(screen.getByLabelText('Unstage a.ts'));
    expect(client.send).toHaveBeenCalledWith({ type: 'git:unstage', path: 'a.ts' });
  });

  it('commits with the typed message when staged files exist, and disables commit otherwise', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: ['a.ts'], unstaged: [], untracked: [] });
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'fix bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(client.send).toHaveBeenCalledWith({ type: 'git:commit', message: 'fix bug' });
  });

  it('opens a diff view when a file is clicked', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: ['a.ts'], untracked: [] });
    fireEvent.click(screen.getByText('a.ts'));
    expect(client.send).toHaveBeenCalledWith({ type: 'git:diff', path: 'a.ts', staged: false });
    client.emit({ type: 'git:diff', path: 'a.ts', staged: false, before: 'old', after: 'new' });
    expect(screen.getByTestId('monaco-diff-stub').textContent).toBe('old|new');
  });

  it('switches branches via the branch selector', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
    client.emit({ type: 'git:branches', branches: [{ name: 'main', current: true }, { name: 'feature', current: false }] });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'feature' } });
    expect(client.send).toHaveBeenCalledWith({ type: 'git:checkout', name: 'feature' });
  });

  it('re-requests git:status when an fs:watch-event message arrives', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
    client.send.mockClear();
    client.emit({ type: 'fs:watch-event', path: 'a.ts', kind: 'change' });
    expect(client.send).toHaveBeenCalledWith({ type: 'git:status' });
  });

  it('shows an error message from git:error', () => {
    const client = fakeClient();
    render(<GitPanel client={client as unknown as WsClient} />);
    client.emit({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
    client.emit({ type: 'git:error', message: 'Commit message is required' });
    expect(screen.getByText('Commit message is required')).toBeTruthy();
  });
});

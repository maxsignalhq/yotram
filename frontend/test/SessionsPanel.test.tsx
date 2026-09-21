import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SessionsPanel } from '../src/components/SessionsPanel';

describe('SessionsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches sessions for the given workspace path on mount', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [] });
    render(<SessionsPanel workspacePath="/tmp/project" onResume={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/sessions?path=%2Ftmp%2Fproject'));
  });

  it('shows the empty state when there are no sessions', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [] });
    render(<SessionsPanel workspacePath="/tmp/project" onResume={() => {}} />);
    expect(await screen.findByText('No past sessions found for this project.')).toBeTruthy();
  });

  it('renders a list of sessions with agent badge, title, and a Resume button', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'abc', agent: 'claude', title: 'Fixed the bug', updatedAt: Date.now() }],
    });
    render(<SessionsPanel workspacePath="/tmp/project" onResume={() => {}} />);
    expect(await screen.findByText('Fixed the bug')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('calls onResume with the claude resume command when clicked', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'abc', agent: 'claude', title: 'Fixed the bug', updatedAt: Date.now() }],
    });
    const onResume = vi.fn();
    render(<SessionsPanel workspacePath="/tmp/project" onResume={onResume} />);
    await screen.findByText('Fixed the bug');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('claude --resume abc\r');
  });

  it('calls onResume with the codex resume command when clicked', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'xyz', agent: 'codex', title: 'Investigated the bug', updatedAt: Date.now() }],
    });
    const onResume = vi.fn();
    render(<SessionsPanel workspacePath="/tmp/project" onResume={onResume} />);
    await screen.findByText('Investigated the bug');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('codex resume xyz\r');
  });

  it('shows an error message when the fetch fails', async () => {
    (fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<SessionsPanel workspacePath="/tmp/project" onResume={() => {}} />);
    expect(await screen.findByText('Unable to load sessions')).toBeTruthy();
  });
});

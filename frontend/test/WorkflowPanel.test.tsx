import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorkflowPanel } from '../src/components/WorkflowPanel';

function baseProps() {
  return {
    workspace: { id: 'w1', name: 'proj', path: '/tmp/proj' },
    currentFile: null,
    currentSession: 'main',
    previewPort: undefined,
    onClose: vi.fn(),
    onRun: vi.fn(),
    onFile: vi.fn(),
    onPreview: vi.fn(),
    onSession: vi.fn(),
    onOpenWorkspace: vi.fn(),
  };
}

function mockApi(overrides: { agents?: unknown; activity?: unknown; resources?: unknown } = {}) {
  (fetch as any).mockImplementation((url: string) => {
    if (url === '/api/agents') return Promise.resolve({ ok: true, json: async () => overrides.agents ?? { claude: false, codex: false } });
    if (url.endsWith('/activity')) return Promise.resolve({ ok: true, json: async () => overrides.activity ?? { events: [], handoffs: [], checkpoints: [], experiments: [], retentionDays: 30 } });
    if (url.endsWith('/resources')) return Promise.resolve({ ok: true, json: async () => overrides.resources ?? [] });
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

describe('WorkflowPanel races', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('only offers installed agents as race choices', async () => {
    mockApi({ agents: { claude: true, codex: false } });
    render(<WorkflowPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Experiments', exact: true }));
    expect(await screen.findByLabelText('Claude')).toBeTruthy();
    expect(screen.queryByLabelText('Codex')).toBeNull();
  });

  it('submits the race with the typed prompt and checked agents', async () => {
    mockApi({ agents: { claude: true, codex: true } });
    render(<WorkflowPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Experiments', exact: true }));
    await screen.findByLabelText('Claude');
    fireEvent.change(screen.getByLabelText('Race task'), { target: { value: 'Refactor the login form' } });
    fireEvent.click(screen.getByLabelText('Claude'));
    fireEvent.click(screen.getByRole('button', { name: 'Start race' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces/w1/races', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'Refactor the login form', agents: ['claude'], checkpointId: undefined }),
    })));
  });

  it('groups experiments that share a raceId under one heading, separate from standalone experiments', async () => {
    mockApi({
      agents: { claude: true, codex: true },
      activity: {
        events: [], handoffs: [], retentionDays: 30,
        checkpoints: [],
        experiments: [
          { id: 'e1', name: 'claude — Refactor the login form', path: '/tmp/e1', branch: 'b1', port: 4001, raceId: 'race-1', agent: 'claude', sessionId: 's1' },
          { id: 'e2', name: 'codex — Refactor the login form', path: '/tmp/e2', branch: 'b2', port: 4002, raceId: 'race-1', agent: 'codex', sessionId: 's2' },
          { id: 'e3', name: 'Solo try', path: '/tmp/e3', branch: 'b3', port: 4003 },
        ],
      },
    });
    render(<WorkflowPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Experiments', exact: true }));
    expect(await screen.findByText('Race: Refactor the login form')).toBeTruthy();
    expect(screen.getByText('claude — Refactor the login form')).toBeTruthy();
    expect(screen.getByText('codex — Refactor the login form')).toBeTruthy();
    expect(screen.getByText('Solo try')).toBeTruthy();
  });
});

describe('WorkflowPanel GitHub PR integration', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('creates a pull request for an experiment with no PR yet', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      agents: { claude: false, codex: false, gh: true },
      activity: {
        events: [], handoffs: [], retentionDays: 30, checkpoints: [],
        experiments: [{ id: 'exp-1', name: 'Try a fix', path: '/tmp/exp-1', branch: 'yotram/experiment-1', base: 'abc', port: 4001 }],
      },
    });
    render(<WorkflowPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Experiments', exact: true }));
    await screen.findByText('Try a fix');
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces/w1/experiments/exp-1/pr', expect.objectContaining({ method: 'POST' })));
    confirmSpy.mockRestore();
  });

  it('shows the PR link, state, and checks badges once a PR exists, and can refresh', async () => {
    mockApi({
      agents: { claude: false, codex: false, gh: true },
      activity: {
        events: [], handoffs: [], retentionDays: 30, checkpoints: [],
        experiments: [{ id: 'exp-1', name: 'Try a fix', path: '/tmp/exp-1', branch: 'yotram/experiment-1', base: 'abc', port: 4001, prUrl: 'https://github.com/test/repo/pull/1', prState: 'open', prChecks: 'passing' }],
      },
    });
    render(<WorkflowPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Experiments', exact: true }));
    await screen.findByText('Try a fix');
    const link = screen.getByRole('link', { name: /View PR/ });
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/pull/1');
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('passing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh PR status' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces/w1/experiments/exp-1/pr', expect.objectContaining({ method: 'GET' })));
  });
});

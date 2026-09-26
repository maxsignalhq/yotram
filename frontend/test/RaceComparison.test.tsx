import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RaceComparison } from '../src/components/RaceComparison';

const CLAUDE_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const CODEX_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..3333333 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,3 @@
 const a = 1;
+const b = 2;
+const c = 3;
`;

const MEMBERS = [
  { id: 'exp-claude', name: 'claude — task', path: '/tmp/claude', branch: 'yotram/experiment-1', base: 'abc', port: 4001, raceId: 'race-1', agent: 'claude', sessionId: 'sess-claude' },
  { id: 'exp-codex', name: 'codex — task', path: '/tmp/codex', branch: 'yotram/experiment-2', base: 'abc', port: 4002, raceId: 'race-1', agent: 'codex', sessionId: 'sess-codex' },
];

const RESOURCES = [
  { id: 'sess-claude', exitCode: undefined },
  { id: 'sess-codex', exitCode: 0 },
];

describe('RaceComparison', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('exp-claude')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CLAUDE_DIFF }) } as Response);
      if (url.includes('exp-codex')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CODEX_DIFF }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('fetches and renders one column per member with stats', async () => {
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    expect(screen.getByText('1 file · +1/-0')).toBeInTheDocument();
    expect(screen.getByText('1 file · +2/-0')).toBeInTheDocument();
  });

  it('marks a winner via PATCH and reports the change', async () => {
    const onWinnerChange = vi.fn();
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={onWinnerChange} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    const winnerButtons = screen.getAllByRole('button', { name: /mark winner/i });
    await userEvent.click(winnerButtons[0]);
    await waitFor(() => expect(onWinnerChange).toHaveBeenCalled());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/experiments/exp-claude/winner') && call[1]?.method === 'PATCH')).toBe(true);
  });

  it('capitalizes the agent name and shows Running/Exited status from resources', async () => {
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Claude')).toBeInTheDocument());
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Exited')).toBeInTheDocument();
  });

  it('shows an error and does not call onWinnerChange when the winner PATCH fails', async () => {
    const onWinnerChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('exp-claude/diff')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CLAUDE_DIFF }) } as Response);
      if (url.includes('exp-codex/diff')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CODEX_DIFF }) } as Response);
      if (init?.method === 'PATCH') return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Only race members can be marked as a winner.' }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    }));
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={onWinnerChange} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    const winnerButtons = screen.getAllByRole('button', { name: /mark winner/i });
    await userEvent.click(winnerButtons[0]);
    await waitFor(() => expect(screen.getByText('Only race members can be marked as a winner.')).toBeInTheDocument());
    expect(onWinnerChange).not.toHaveBeenCalled();
  });

  it('fetches each member diff sequentially to avoid contending on the backend per-workspace git lock', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      concurrent--;
      if (url.includes('exp-claude')) return { ok: true, json: () => Promise.resolve({ diff: CLAUDE_DIFF }) } as Response;
      return { ok: true, json: () => Promise.resolve({ diff: CODEX_DIFF }) } as Response;
    }));
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('1 file · +1/-0')).toBeInTheDocument());
    expect(maxConcurrent).toBe(1);
  });

  it('disables the Mark winner button while the request is in flight', async () => {
    let resolvePatch: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('exp-claude/diff')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CLAUDE_DIFF }) } as Response);
      if (url.includes('exp-codex/diff')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ diff: CODEX_DIFF }) } as Response);
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = () => resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response); });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    }));
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} resources={RESOURCES} onWinnerChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    const winnerButtons = screen.getAllByRole('button', { name: /mark winner/i });
    await userEvent.click(winnerButtons[0]);
    await waitFor(() => expect(winnerButtons[0]).toBeDisabled());
    resolvePatch?.();
    await waitFor(() => expect(winnerButtons[0]).not.toBeDisabled());
  });
});

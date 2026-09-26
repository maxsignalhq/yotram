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
  { id: 'exp-claude', name: 'claude — task', path: '/tmp/claude', branch: 'yotram/experiment-1', base: 'abc', port: 4001, raceId: 'race-1', agent: 'claude' },
  { id: 'exp-codex', name: 'codex — task', path: '/tmp/codex', branch: 'yotram/experiment-2', base: 'abc', port: 4002, raceId: 'race-1', agent: 'codex' },
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
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} onWinnerChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    expect(screen.getByText('1 files · +1/-0')).toBeInTheDocument();
    expect(screen.getByText('1 files · +2/-0')).toBeInTheDocument();
  });

  it('marks a winner via PATCH and reports the change', async () => {
    const onWinnerChange = vi.fn();
    render(<RaceComparison workspaceId="ws-1" raceId="race-1" members={MEMBERS} onWinnerChange={onWinnerChange} />);
    await waitFor(() => expect(screen.getByText(/claude/i)).toBeInTheDocument());
    const winnerButtons = screen.getAllByRole('button', { name: /mark winner/i });
    await userEvent.click(winnerButtons[0]);
    await waitFor(() => expect(onWinnerChange).toHaveBeenCalled());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/experiments/exp-claude/winner') && call[1]?.method === 'PATCH')).toBe(true);
  });
});

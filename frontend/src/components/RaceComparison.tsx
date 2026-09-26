import { useEffect, useState } from 'react';
import { parseUnifiedDiff, type ParsedFile } from '../diffParser';

interface RaceMember { id: string; name: string; path: string; branch: string; base: string; port: number; raceId?: string; agent?: string; sessionId?: string; winner?: boolean }
interface RaceResource { id: string; exitCode?: number }
interface RaceComparisonProps { workspaceId: string; raceId: string; members: RaceMember[]; resources: RaceResource[]; onWinnerChange: () => void }
interface ColumnState { loading: boolean; error: string; files: ParsedFile[] }

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function RaceComparison({ workspaceId, members, resources, onWinnerChange }: RaceComparisonProps) {
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [winnerError, setWinnerError] = useState<Record<string, string>>({});
  const [winnerPending, setWinnerPending] = useState<Record<string, boolean>>({});

  const memberIdsKey = members.map(m => m.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setColumns(previous => {
      const next: Record<string, ColumnState> = {};
      for (const member of members) next[member.id] = previous[member.id] ?? { loading: true, error: '', files: [] };
      return next;
    });
    (async () => {
      // Fetched sequentially, not in parallel: the backend serializes all git
      // operations for a workspace behind one lock, so concurrent per-member diff
      // requests contend on it and one fails with "Another Git operation is in
      // progress for this workspace."
      for (const member of members) {
        let result: ColumnState;
        try {
          const response = await fetch(`/api/workspaces/${workspaceId}/experiments/${member.id}/diff`);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? 'Failed to load diff');
          result = { loading: false, error: '', files: parseUnifiedDiff(body.diff ?? '') };
        } catch (error) {
          result = { loading: false, error: (error as Error).message, files: [] };
        }
        if (cancelled) return;
        setColumns(previous => ({ ...previous, [member.id]: result }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, memberIdsKey]);

  async function markWinner(memberId: string, winner: boolean) {
    setWinnerPending(previous => ({ ...previous, [memberId]: true }));
    setWinnerError(previous => ({ ...previous, [memberId]: '' }));
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/experiments/${memberId}/winner`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winner }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Failed to update winner');
      onWinnerChange();
    } catch (error) {
      setWinnerError(previous => ({ ...previous, [memberId]: (error as Error).message }));
    } finally {
      setWinnerPending(previous => ({ ...previous, [memberId]: false }));
    }
  }

  return <div className="race-comparison">
    {members.map(member => {
      const column = columns[member.id];
      const additions = column?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0;
      const deletions = column?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0;
      const resource = member.sessionId ? resources.find(r => r.id === member.sessionId) : undefined;
      return <div className="race-comparison-column" key={member.id}>
        <header>
          <strong>{member.agent ? capitalize(member.agent) : member.name}</strong>
          {resource && <span className="race-status">{resource.exitCode === undefined ? 'Running' : 'Exited'}</span>}
          <button aria-pressed={member.winner === true} disabled={winnerPending[member.id] === true} onClick={() => void markWinner(member.id, member.winner !== true)}>★ Mark winner</button>
        </header>
        {winnerError[member.id] && <p role="alert">{winnerError[member.id]}</p>}
        {column?.loading && <p>Loading diff…</p>}
        {column?.error && <p role="alert">{column.error}</p>}
        {column && !column.loading && !column.error && <>
          <p>{column.files.length} {column.files.length === 1 ? 'file' : 'files'} · +{additions}/-{deletions}</p>
          {column.files.map(file => <details key={file.path}>
            <summary>{file.path} · {file.hunks.length === 0 && file.additions === 0 && file.deletions === 0 ? 'Binary file' : `+${file.additions}/-${file.deletions}`}</summary>
            {file.hunks.map((hunk, i) => <div key={i}>
              <small>{hunk.header}</small>
              {hunk.lines.map((line, j) => <div key={j} className={`diffline-${line.type}`}>{line.text}</div>)}
            </div>)}
          </details>)}
        </>}
      </div>;
    })}
  </div>;
}

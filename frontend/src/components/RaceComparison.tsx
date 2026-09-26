import { useEffect, useState } from 'react';
import { parseUnifiedDiff, type ParsedFile } from '../diffParser';

interface RaceMember { id: string; name: string; path: string; branch: string; base: string; port: number; raceId?: string; agent?: string; sessionId?: string; winner?: boolean }
interface RaceComparisonProps { workspaceId: string; raceId: string; members: RaceMember[]; onWinnerChange: () => void }
interface ColumnState { loading: boolean; error: string; files: ParsedFile[] }

export function RaceComparison({ workspaceId, members, onWinnerChange }: RaceComparisonProps) {
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});

  useEffect(() => {
    let cancelled = false;
    setColumns(Object.fromEntries(members.map(m => [m.id, { loading: true, error: '', files: [] }])));
    Promise.all(members.map(async member => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/experiments/${member.id}/diff`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Failed to load diff');
        return [member.id, { loading: false, error: '', files: parseUnifiedDiff(body.diff ?? '') }] as const;
      } catch (error) {
        return [member.id, { loading: false, error: (error as Error).message, files: [] }] as const;
      }
    })).then(results => { if (!cancelled) setColumns(Object.fromEntries(results)); });
    return () => { cancelled = true; };
  }, [workspaceId, members]);

  async function markWinner(memberId: string, winner: boolean) {
    await fetch(`/api/workspaces/${workspaceId}/experiments/${memberId}/winner`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winner }),
    });
    onWinnerChange();
  }

  return <div className="race-comparison">
    {members.map(member => {
      const column = columns[member.id];
      const additions = column?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0;
      const deletions = column?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0;
      return <div className="race-comparison-column" key={member.id}>
        <header>
          <strong>{member.agent ?? member.name}</strong>
          <button aria-pressed={member.winner === true} onClick={() => void markWinner(member.id, member.winner !== true)}>★ Mark winner</button>
        </header>
        {column?.loading && <p>Loading diff…</p>}
        {column?.error && <p role="alert">{column.error}</p>}
        {column && !column.loading && !column.error && <>
          <p>{column.files.length} files · +{additions}/-{deletions}</p>
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

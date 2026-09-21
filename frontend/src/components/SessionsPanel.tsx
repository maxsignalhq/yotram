import { useEffect, useState } from 'react';

interface Session { id: string; agent: 'claude' | 'codex'; title: string; updatedAt: number }

function relativeTime(ms: number): string {
  const diffMinutes = Math.round((Date.now() - ms) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function resumeCommand(session: Session): string {
  return session.agent === 'claude' ? `claude --resume ${session.id}\r` : `codex resume ${session.id}\r`;
}

export function SessionsPanel({ workspacePath, onResume }: { workspacePath: string; onResume: (command: string) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setError('');
    fetch(`/api/sessions?path=${encodeURIComponent(workspacePath)}`)
      .then(response => { if (!response.ok) throw new Error('Unable to load sessions'); return response.json(); })
      .then(result => { if (!cancelled) setSessions(result); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [workspacePath]);

  if (error) return <div className="sessions-panel"><p role="alert" className="editor-conflict">{error}</p></div>;
  if (!sessions) return <div className="sessions-panel" role="status">Loading…</div>;
  if (sessions.length === 0) return <div className="sessions-panel"><p className="git-empty">No past sessions found for this project.</p></div>;

  return <div className="sessions-panel">
    <ul className="sessions-list">
      {sessions.map(session => <li key={`${session.agent}-${session.id}`}>
        <span className="session-agent-badge">{session.agent === 'claude' ? 'Claude' : 'Codex'}</span>
        <span className="session-title">{session.title}</span>
        <span className="session-time">{relativeTime(session.updatedAt)}</span>
        <button onClick={() => onResume(resumeCommand(session))}>Resume</button>
      </li>)}
    </ul>
  </div>;
}

import { useEffect, useState } from 'react';
import { FolderPicker } from './FolderPicker';
export interface Workspace { id: string; name: string; path: string }
export function Dashboard({ onOpen }: { onOpen: (workspace: Workspace) => void }) {
  const [picker, setPicker] = useState<'open' | 'create' | null>(null);
  const [directory, setDirectory] = useState('');
  const [current, setCurrent] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState<Record<string, { count: number; attention: number }>>({});
  const [recent, setRecent] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('yotram.projects') ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 12) : []; } catch { return []; }
  });
  useEffect(() => {
    fetch('/api/workspaces/default').then(response => { if (response.status === 401) { window.location.reload(); return; } if (!response.ok) throw new Error('Unable to connect to the project server'); return response.json(); }).then(result => { if (result) setCurrent(result); }).catch(error => setError(error.message));
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => fetch('/api/workspaces').then(r => { if (!r.ok) throw new Error('Unable to load shared projects'); return r.json(); }).then(items => {
      if (!active || !Array.isArray(items)) return;
      setRecent(items.map((w: Workspace) => w.path));
      setRunning(Object.fromEntries(items.map((w: Workspace & { sessions: { exitCode?: number; attention?: string }[] }) => [w.path, { count: w.sessions.filter(s => s.exitCode === undefined).length, attention: w.sessions.filter(s => s.attention).length }])));
    }).catch(() => {});
    void update(); const timer = setInterval(update, 5000); return () => { active = false; clearInterval(timer); };
  }, []);
  async function forget(path: string) {
    try {
      const response = await fetch('/api/workspaces'); const items = await response.json(); const workspace = items.find((w: Workspace) => w.path === path);
      if (workspace) { const result = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' }); if (!result.ok) { const body = await result.json(); throw new Error(body.error); } }
      remember(recent.filter(item => item !== path));
    } catch (e) { setError((e as Error).message); }
  }
  function remember(paths: string[]) { setRecent(paths); try { localStorage.setItem('yotram.projects', JSON.stringify(paths)); } catch { /* Browser storage may be disabled. */ } }
  async function open(path: string, create = false) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, create }) });
      if (response.status === 401) { window.location.reload(); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to open project');
      remember([result.path, ...recent.filter(item => item !== result.path)].slice(0, 12));
      onOpen(result);
    } catch (error) { setError(error instanceof TypeError ? 'Cannot connect to Yotram. Check that the local server is running, then try again.' : (error as Error).message); } finally { setBusy(false); }
  }
  const [copied, setCopied] = useState(false);
  return <main className="dashboard"><div className="dashboard-inner">
    <div className="dashboard-topbar">
      <span className="dashboard-share" title="Open this address from another device on your network">
        {window.location.origin}
        <button type="button" onClick={() => { navigator.clipboard?.writeText(window.location.origin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
      </span>
      <button type="button" onClick={() => { void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.reload()); }}>Log out</button>
    </div>
    <p className="eyebrow">YOTRAM · LOCAL WORKSPACES</p><h1>Your projects, in your browser.</h1>
    <p className="dashboard-description">Open a folder on this Mac, or create a starter web app. Your files stay on disk.</p>
    {error && <p role="alert" className="editor-conflict">{error}</p>}
    <section className="project-card"><h2>Open a project</h2>
      <button className="button-primary" disabled={!current || busy} onClick={() => current && open(current.path)}>Open current directory</button>
      <p className="project-path">{current?.path ?? 'Connecting…'}</p>
      <form onSubmit={event => { event.preventDefault(); if (directory.trim()) void open(directory); else { setError(''); setPicker('open'); } }}>
        <label htmlFor="project-directory">Project folder path</label>
        <input id="project-directory" value={directory} onChange={event => setDirectory(event.target.value)} placeholder="Optional: type a path, or use the buttons below" />
        <div className="dashboard-actions"><button disabled={busy} type="submit">Open folder</button><button disabled={busy} type="button" onClick={() => { if (directory.trim()) void open(directory, true); else { setError(''); setPicker('create'); } }}>Create starter project</button></div>
      </form><p>New projects include a simple web app. The parent folder must already exist.</p>
      {busy && <p role="status">Opening project…</p>}
    </section>
    {recent.length > 0 && <section><h2>Recent projects</h2>{recent.map(path => <div className="recent-project" key={path}><button disabled={busy} onClick={() => void open(path)}><strong>{path.split('/').pop()}</strong><span>{path}</span><span>{running[path]?.count ?? 0} running{running[path]?.attention ? ` · ${running[path].attention} need attention` : ''}</span></button><button className="button-icon" aria-label={`Forget ${path}`} title="Forget" onClick={() => void forget(path)}>✕</button></div>)}</section>}
  </div>{picker && <FolderPicker create={picker === 'create'} busy={busy} error={error} onClose={() => { setPicker(null); setError(''); }} onSelect={path => void open(path, picker === 'create')} />}</main>;
}

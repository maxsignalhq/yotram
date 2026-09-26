import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from './Dashboard';
import { RaceComparison } from './RaceComparison';
interface Event { id: string; at: number; kind: string; summary: string; file?: string; sessionId?: string; detail?: string }
interface Handoff { id: string; at: number; note: string; next: string; file?: string; sessionId?: string; checkpointId?: string; branch?: string; port?: number }
interface Checkpoint { id: string; at: number; label: string; ref: string; patch: string }
interface Experiment { id: string; name: string; path: string; branch: string; base: string; port: number; raceId?: string; agent?: string; sessionId?: string; winner?: boolean; prUrl?: string; prState?: 'open' | 'merged' | 'closed'; prChecks?: 'pending' | 'passing' | 'failing' | 'none' }
interface Activity { events: Event[]; handoffs: Handoff[]; checkpoints: Checkpoint[]; experiments: Experiment[]; retentionDays: number }
interface Resource { id: string; label: string; pid: number; attention?: string; startedAt: number; exitCode?: number; processes: { pid: number; cpu: number; memoryKB: number; command: string; ports: number[]; elapsed: string }[] }
interface Props { workspace: Workspace; currentFile: string | null; currentSession: string; previewPort?: number; onClose: () => void; onRun: (command: string) => void; onFile: (file: string) => void; onPreview: (port: number) => void; onSession: (sessionId: string) => void; onOpenWorkspace: (workspace: Workspace) => void }
export function WorkflowPanel(props: Props) {
  const { workspace, onClose, onRun, onFile, onPreview, onSession, onOpenWorkspace } = props;
  const base = `/api/workspaces/${workspace.id}`;
  const [tab, setTab] = useState('Recap');
  const [activity, setActivity] = useState<Activity>({ events: [], handoffs: [], checkpoints: [], experiments: [], retentionDays: 30 });
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(''); const [sessionFilter, setSessionFilter] = useState('');
  const [detail, setDetail] = useState(''); const [note, setNote] = useState(''); const [next, setNext] = useState('');
  const [checkpoint, setCheckpoint] = useState(''); const [label, setLabel] = useState(''); const [experimentName, setExperimentName] = useState('');
  const [command, setCommand] = useState('');
  const [racePrompt, setRacePrompt] = useState(''); const [raceAgents, setRaceAgents] = useState<string[]>([]);
  const [installedAgents, setInstalledAgents] = useState<{ claude: boolean; codex: boolean; gh: boolean }>({ claude: false, codex: false, gh: false });
  const [comparingRace, setComparingRace] = useState<string | null>(null);
  useEffect(() => { fetch('/api/agents').then(r => r.json()).then(setInstalledAgents).catch(() => {}); }, []);
  const readKey = `yotram.read.${workspace.id}`;
  const [readAt, setReadAt] = useState(() => { try { return Number(localStorage.getItem(readKey) ?? 0); } catch { return 0; } });
  const api = useCallback(async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error ?? 'Request failed'); return value;
  }, [base]);
  const refresh = useCallback(async () => { const [history, running] = await Promise.all([api('/activity'), api('/resources')]); setActivity(history); setResources(running); if (history.persistenceError) setError('History could not be saved: ' + history.persistenceError); }, [api]);
  useEffect(() => { let active = true; const update = () => { if (active) void refresh().catch(e => { if (active) setError(e.message); }); }; update(); const timer = setInterval(update, 5000); return () => { active = false; clearInterval(timer); }; }, [refresh]);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const events = activity.events.filter(e => (tab !== 'Recap' || e.at > readAt) && (!sessionFilter || e.sessionId === sessionFilter) && `${e.summary} ${e.file ?? ''} ${e.kind}`.toLowerCase().includes(filter.toLowerCase()));
  const raceGroups: [string, Experiment[]][] = [];
  const standaloneExperiments: Experiment[] = [];
  for (const experiment of activity.experiments) {
    if (!experiment.raceId) { standaloneExperiments.push(experiment); continue; }
    const group = raceGroups.find(([id]) => id === experiment.raceId);
    if (group) group[1].push(experiment); else raceGroups.push([experiment.raceId, [experiment]]);
  }
  const activeCount = resources.filter(s => s.exitCode === undefined).length;
  function markRead() { const at = activity.events.at(-1)?.at ?? Date.now(); setReadAt(at); try { localStorage.setItem(readKey, String(at)); } catch { /* session-only read state */ } }
  async function restore(handoff: Handoff) {
    const warnings: string[] = [];
    if (handoff.file) onFile(handoff.file);
    if (handoff.port) onPreview(handoff.port);
    if (handoff.sessionId) { if (resources.some(s => s.id === handoff.sessionId && s.exitCode === undefined)) onSession(handoff.sessionId); else warnings.push('The saved terminal is no longer running.'); }
    if (handoff.checkpointId && !activity.checkpoints.some(c => c.id === handoff.checkpointId)) warnings.push('The saved checkpoint is unavailable.');
    setDetail(`Handoff from branch ${handoff.branch || '(not recorded)'}. Restoring context does not switch branches or reset files.\n\n${handoff.note}\n\nNext: ${handoff.next}\n\n${warnings.join('\n')}`);
  }
  const experimentCard = (experiment: Experiment) => {
    const resource = experiment.sessionId ? resources.find(r => r.id === experiment.sessionId) : undefined;
    return <article key={experiment.id}><strong>{experiment.name}</strong><small>{experiment.branch}</small>{resource && <span className="race-status">{resource.exitCode === undefined ? 'Running' : 'Exited'}</span>}{experiment.winner && <span className="winner-badge">★ Winner</span>}<p>Suggested preview port: {experiment.port}. Start your app with this port; availability can change.</p><div className="workflow-actions">{experiment.sessionId && <button onClick={() => onSession(experiment.sessionId!)}>Open terminal</button>}<button onClick={() => void action(async () => { const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: experiment.path }) }); const w = await response.json(); if (!response.ok) throw new Error(w.error); onOpenWorkspace(w); })}>Open experiment</button><button onClick={() => onPreview(experiment.port)}>Preview</button><button disabled={busy} onClick={() => void action(async () => { const result = await api(`/experiments/${experiment.id}/diff`); setDetail(result.diff || 'No changes from starting checkpoint.'); })}>Compare changes</button><button disabled={busy} onClick={() => { if (window.confirm('Merge this experiment into the current branch? Both workspaces must be committed and clean. Conflicts require resolution in Git or the terminal.')) void action(async () => { await api(`/experiments/${experiment.id}/merge`, 'POST'); }); }}>Merge</button><button onClick={() => setDetail(`Kept branch: ${experiment.branch}\nWorktree: ${experiment.path}\nIt remains available until you explicitly discard it.`)}>Keep branch</button><button disabled={busy} onClick={() => { if (window.confirm(`Permanently discard "${experiment.name}", its branch, and uncommitted worktree files? Stop its sessions first.`)) void action(async () => { await api(`/experiments/${experiment.id}`, 'DELETE', { confirm: true }); }); }}>Discard</button>{!experiment.prUrl && <button disabled={busy || !installedAgents.gh} title={!installedAgents.gh ? 'GitHub CLI (gh) is not available on the server.' : undefined} onClick={() => { if (window.confirm(`Push branch ${experiment.branch} to origin and open a pull request? This publishes it to your remote repository.`)) void action(async () => { await api(`/experiments/${experiment.id}/pr`, 'POST', {}); }); }}>Create PR</button>}{experiment.prUrl && <><a href={experiment.prUrl} target="_blank" rel="noreferrer">View PR ↗</a><span className={`pr-state pr-state-${experiment.prState}`}>{experiment.prState}</span><span className={`pr-checks pr-checks-${experiment.prChecks}`}>{experiment.prChecks}</span><button disabled={busy} onClick={() => void action(async () => { await api(`/experiments/${experiment.id}/pr`); })}>Refresh PR status</button></>}</div></article>;
  };
  return <aside className="workflow-panel" aria-label="Workspace tools">
    <header><div><h2>Workspace tools</h2><span>{workspace.name} · {activeCount} running</span></div><button onClick={onClose} aria-label="Close workspace tools">×</button></header>
    <nav aria-label="Workspace tool views">{['Recap', 'Timeline', 'Handoffs', 'Resources', 'Experiments'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => { setTab(name); setDetail(''); }}>{name}{name === 'Recap' ? ` (${activity.events.filter(e => e.at > readAt).length})` : ''}</button>)}</nav>
    {error && <p role="alert" className="editor-conflict">{error}</p>}
    {busy && <p role="status">Working…</p>}
    <div className="workflow-content" key={tab}>
    {(tab === 'Recap' || tab === 'Timeline') && <>
      <h3>{tab === 'Recap' ? 'What did I miss?' : 'Project flight recorder'}</h3>
      <p>{events.filter(e => e.kind === 'file').length} file events · {events.filter(e => e.kind === 'complete' || e.kind === 'exit').length} completions · {resources.filter(r => r.attention).length} sessions need attention</p>
      <div className="workflow-actions"><input aria-label="Filter activity" placeholder="Filter by file, kind, or text" value={filter} onChange={e => setFilter(e.target.value)} /><select aria-label="Filter session" value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}><option value="">All sessions</option>{[...new Set(activity.events.map(e => e.sessionId).filter(Boolean))].map(id => <option key={id} value={id}>{resources.find(r => r.id === id)?.label ?? id?.slice(0, 8)}</option>)}</select></div>
      {tab === 'Recap' && <button onClick={markRead}>Mark as read</button>}
      {events.length === 0 && <p>No matching activity. File changes and managed session events will appear here.</p>}
      <ol className="activity-list">{events.slice().reverse().slice(0, 200).map(event => <li key={event.id}><small>{new Date(event.at).toLocaleString()} · {event.kind}</small><p>{event.summary}</p><div className="workflow-actions">{event.file && <button onClick={() => onFile(event.file!)}>Open file</button>}{event.sessionId && <button onClick={() => void action(async () => { const result = await api(`/output/${encodeURIComponent(event.sessionId!)}`); setDetail(`${result.running ? 'Live session' : 'Historical output'} — recent output, up to 64 KB\n\n${result.output || '(No retained output)'}`); })}>View output</button>}{event.detail && <button onClick={() => setDetail(event.detail!)}>View evidence</button>}</div></li>)}</ol>
      {events.length > 200 && <p>Showing the latest 200 matches. Narrow the filter to inspect older activity.</p>}
      {tab === 'Timeline' && <><h3>Retention</h3><p>History stores recent terminal output locally. Redaction is best effort; avoid entering secrets in recorded commands.</p><label>Keep events for <input aria-label="Retention days" type="number" min="1" max="365" value={activity.retentionDays} onChange={e => setActivity({ ...activity, retentionDays: Number(e.target.value) })} /> days</label><button disabled={busy} onClick={() => void action(async () => { await api('/activity', 'PATCH', { retentionDays: activity.retentionDays }); })}>Save retention</button><button disabled={busy} onClick={() => { if (window.confirm('Clear recorded activity and retained terminal output? Saved handoffs and checkpoints remain.')) void action(async () => { await api('/activity', 'DELETE'); markRead(); }); }}>Clear history</button></>}
    </>}
    {tab === 'Handoffs' && <>
      <h3>Leave a handoff</h3><label>Notes<textarea value={note} onChange={e => setNote(e.target.value)} /></label><label>Next step<textarea value={next} onChange={e => setNext(e.target.value)} /></label>
      <label>Checkpoint<select value={checkpoint} onChange={e => setCheckpoint(e.target.value)}><option value="">None</option>{activity.checkpoints.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <p>Includes current file, selected terminal, preview port when opened from Resources, and current branch.</p>
      <button disabled={busy || (!note.trim() && !next.trim())} onClick={() => void action(async () => { await api('/handoffs', 'POST', { note, next, file: props.currentFile ?? '', sessionId: props.currentSession, port: props.previewPort, checkpointId: checkpoint }); setNote(''); setNext(''); })}>Save handoff</button>
      {activity.handoffs.map(h => <article key={h.id}><small>{new Date(h.at).toLocaleString()} · {h.branch}</small><p>{h.note}</p><p><strong>Next:</strong> {h.next}</p><div className="workflow-actions"><button onClick={() => void restore(h)}>Restore context</button><button onClick={() => setDetail(`Project: ${workspace.path}\nBranch: ${h.branch ?? 'unknown'}\nFile: ${h.file || 'none'}\nCheckpoint: ${h.checkpointId || 'none'}\n\n${h.note}\n\nNext: ${h.next}`)}>Prepare agent handoff</button><button disabled={busy} onClick={() => { if (window.confirm('Delete this handoff?')) void action(async () => { await api(`/handoffs/${h.id}`, 'DELETE'); }); }}>Delete</button></div></article>)}
    </>}
    {tab === 'Resources' && <>
      <h3>Processes owned by this workspace</h3><p>Only processes descended from Yotram’s live terminals are listed. Detached processes may be untracked.</p>
      <form onSubmit={e => { e.preventDefault(); if (command.trim()) { onRun(command); setCommand(''); } }}><label>Run a tracked command<input value={command} onChange={e => setCommand(e.target.value)} placeholder="npm test" /></label><button disabled={!command.trim()}>Run command</button></form>
      <button disabled={busy || !activeCount} onClick={() => { if (window.confirm('Stop all running sessions in this workspace?')) void action(async () => { await api('/stop', 'POST'); }); }}>Stop workspace</button>
      {!resources.length && <p>No terminal sessions. Open a terminal or start an agent.</p>}
      {resources.map(resource => <article key={resource.id}><strong>{resource.label} · {resource.exitCode === undefined ? 'Running' : `Exited (${resource.exitCode})`}</strong><small>Started {new Date(resource.startedAt).toLocaleString()}</small>{resource.attention && <p className="attention">{resource.attention}</p>}<div className="workflow-actions"><button onClick={() => onSession(resource.id)}>Open terminal / acknowledge</button>{resource.exitCode === undefined && <><button disabled={busy} onClick={() => void action(async () => { await api(`/sessions/${resource.id}/stop`, 'POST'); })}>Stop</button><button disabled={busy} onClick={() => { if (window.confirm('Force-stop this session and its currently tracked children? Unsaved process work may be lost.')) void action(async () => { await api(`/sessions/${resource.id}/stop`, 'POST', { force: true }); }); }}>Force stop</button></>}</div>
      <ul>{resource.processes.map(p => <li key={p.pid}>{p.command} · PID {p.pid} · {p.cpu}% CPU · {(p.memoryKB / 1024).toFixed(1)} MB · {p.elapsed}{p.ports.map(port => <button key={port} onClick={() => onPreview(port)}>Preview :{port}</button>)}</li>)}</ul></article>)}
    </>}
    {tab === 'Experiments' && <>
      <h3>Checkpoints and safe experiments</h3><p>Checkpoints snapshot Git files without changing your working tree or index. Ignored files and common secret filenames are excluded; review the diff. Worktrees share your machine and external services.</p>
      <label>Checkpoint name<input value={label} onChange={e => setLabel(e.target.value)} /></label><button disabled={busy || !label.trim()} onClick={() => void action(async () => { const result = await api('/checkpoints', 'POST', { label }); setCheckpoint(result.id); setLabel(''); setDetail(result.patch || 'No changes from HEAD.'); })}>Create checkpoint</button>
      {activity.checkpoints.map(c => <article key={c.id}><strong>{c.label}</strong><small>{new Date(c.at).toLocaleString()} · {c.ref.slice(0, 8)}</small><button onClick={() => { setCheckpoint(c.id); setDetail(c.patch || 'No changes from HEAD.'); }}>Review / select</button></article>)}
      <label>Start from<select value={checkpoint} onChange={e => setCheckpoint(e.target.value)}><option value="">Current HEAD (requires clean workspace)</option>{activity.checkpoints.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <h3>Race agents on one task</h3><p>Runs the same prompt through each selected agent from the checkpoint chosen above (or a fresh one if none is selected), so you can compare their results.</p>
      <label>Race task<textarea value={racePrompt} onChange={e => setRacePrompt(e.target.value)} /></label>
      <fieldset><legend>Agents</legend>{(['claude', 'codex'] as const).filter(a => installedAgents[a]).map(a => <label key={a}><input type="checkbox" checked={raceAgents.includes(a)} onChange={e => setRaceAgents(current => e.target.checked ? [...current, a] : current.filter(x => x !== a))} />{a === 'claude' ? 'Claude' : 'Codex'}</label>)}{!installedAgents.claude && !installedAgents.codex && <p>No agents detected on the server PATH.</p>}</fieldset>
      <button disabled={busy || !racePrompt.trim() || raceAgents.length < 1} onClick={() => void action(async () => { await api('/races', 'POST', { prompt: racePrompt, agents: raceAgents, checkpointId: checkpoint || undefined }); setRacePrompt(''); setRaceAgents([]); })}>Start race</button>
      <label>Experiment name<input value={experimentName} onChange={e => setExperimentName(e.target.value)} /></label><button disabled={busy || !experimentName.trim()} onClick={() => void action(async () => { await api('/experiments', 'POST', { name: experimentName, checkpointId: checkpoint || undefined }); setExperimentName(''); })}>Try an alternative</button>
      {raceGroups.map(([raceId, members]) => <section key={raceId} className="race-group">
        <h4>Race: {members[0].name.split(' — ').slice(1).join(' — ') || 'task'}<button aria-pressed={comparingRace === raceId} onClick={() => setComparingRace(current => current === raceId ? null : raceId)}>Compare race</button></h4>
        {members.map(experimentCard)}
        {comparingRace === raceId && <RaceComparison workspaceId={workspace.id} raceId={raceId} members={members} resources={resources} onWinnerChange={refresh} />}
      </section>)}
      {standaloneExperiments.map(experimentCard)}
    </>}
    {detail && <section className="workflow-detail"><h3>Evidence / context</h3><textarea aria-label="Evidence and context" readOnly value={detail} /><button onClick={() => { navigator.clipboard?.writeText(detail).catch(() => setError('Select and copy the text manually; clipboard access is unavailable.')); }}>Copy text</button><button onClick={() => setDetail('')}>Close details</button></section>}
    </div>
  </aside>;
}

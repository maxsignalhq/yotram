import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';

interface Status { isRepo: boolean; branch: string | null; staged: string[]; unstaged: string[]; untracked: string[] }
interface Branch { name: string; current: boolean }
interface Diff { path: string; staged: boolean; before: string; after: string }

export function GitPanel({ client, theme = 'dark' }: { client: WsClient; theme?: Theme }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const subscriptions = [
      client.on('git:status', msg => setStatus(msg)),
      client.on('git:branches', msg => setBranches(msg.branches)),
      client.on('git:diff', msg => setDiff(msg)),
      client.on('git:error', msg => setError(msg.message)),
      client.on('fs:watch-event', () => client.send({ type: 'git:status' })),
    ];
    client.send({ type: 'git:status' });
    client.send({ type: 'git:branches' });
    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [client]);

  function openDiff(path: string, staged: boolean) {
    setError('');
    client.send({ type: 'git:diff', path, staged });
  }

  if (!status) return <div className="git-panel" role="status">Loading…</div>;
  if (!status.isRepo) return <div className="git-panel"><p className="git-empty">This folder isn't a git repository.</p></div>;

  return <div className="git-panel">
    <div className="pane-toolbar">
      <label htmlFor="git-branch">Branch</label>
      <select id="git-branch" aria-label="Branch" value={status.branch ?? ''} onChange={event => { setError(''); client.send({ type: 'git:checkout', name: event.target.value }); }}>
        {status.branch && !branches.some(b => b.name === status.branch) && <option value={status.branch}>{status.branch}</option>}
        {branches.map(branch => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
      </select>
    </div>
    {error && <div role="alert" className="editor-conflict">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <section>
      <h3>Staged ({status.staged.length})</h3>
      <ul className="git-file-list">{status.staged.map(path => <li key={path}>
        <button onClick={() => openDiff(path, true)}>{path}</button>
        <button aria-label={`Unstage ${path}`} onClick={() => { setError(''); client.send({ type: 'git:unstage', path }); }}>Unstage</button>
      </li>)}</ul>
    </section>
    <section>
      <h3>Changes ({status.unstaged.length + status.untracked.length})</h3>
      <ul className="git-file-list">
        {status.unstaged.map(path => <li key={path}>
          <button onClick={() => openDiff(path, false)}>{path}</button>
          <button aria-label={`Stage ${path}`} onClick={() => { setError(''); client.send({ type: 'git:stage', path }); }}>Stage</button>
        </li>)}
        {status.untracked.map(path => <li key={path}>
          <span>{path}</span>
          <button aria-label={`Stage ${path}`} onClick={() => { setError(''); client.send({ type: 'git:stage', path }); }}>Stage</button>
        </li>)}
      </ul>
    </section>
    <form className="git-commit" onSubmit={event => {
      event.preventDefault();
      if (message.trim()) { setError(''); client.send({ type: 'git:commit', message }); setMessage(''); }
    }}>
      <label htmlFor="commit-message">Commit message</label>
      <textarea id="commit-message" value={message} onChange={event => setMessage(event.target.value)} />
      <button type="submit" disabled={status.staged.length === 0 || !message.trim()}>Commit</button>
    </form>
    {/*
      DiffEditor defaults to height: '100%'. That only resolves if every ancestor up
      to .git-diff-wrapper has a *definite* (not content-derived) height — but
      .git-panel's own height is itself derived from summing its children's content,
      one of which is .git-diff-wrapper (flex: 1). That circular relationship means
      .git-diff-wrapper's height is numerically real (clamped by its min-height) but
      not "definite" per the CSS percentage-resolution rules, so a height: 100% child
      collapses to 0. Passing a fixed pixel height here sidesteps that cascade instead
      of relying on percentage resolution.
    */}
    {diff && <div className="git-diff-wrapper"><DiffEditor height="300px" original={diff.before} modified={diff.after} theme={theme === 'dark' ? 'vs-dark' : 'vs'} options={{ readOnly: true, automaticLayout: true }} /></div>}
  </div>;
}

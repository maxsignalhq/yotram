import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { Theme } from '../../theme';

interface Commit { hash: string; author: string; authoredAt: string; subject: string }
interface ChangedFile { status: string; path: string; previousPath?: string }
interface Diff { before: string; after: string }
async function request<T>(workspaceId: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/git-history/${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Git History request failed');
  return result as T;
}
function shortHash(hash: string) { return hash.slice(0, 8); }
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }

export function GitHistoryPanel({ workspaceId, theme = 'dark', onClose }: { workspaceId: string; theme?: Theme; onClose: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedHash, setSelectedHash] = useState('');
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState('');
  const [loadingCommits, setLoadingCommits] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const selectedCommit = commits.find(commit => commit.hash === selectedHash);

  useEffect(() => {
    let cancelled = false;
    void request<{ commits: Commit[] }>(workspaceId, '?limit=100').then(result => {
      if (cancelled) return;
      setCommits(result.commits); setSelectedHash(result.commits[0]?.hash ?? '');
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); })
      .finally(() => { if (!cancelled) setLoadingCommits(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);
  useEffect(() => {
    if (!selectedHash) { setFiles([]); setSelectedFile(null); setDiff(null); return; }
    let cancelled = false;
    setLoadingFiles(true); setFiles([]); setSelectedFile(null); setDiff(null); setError('');
    void request<{ files: ChangedFile[] }>(workspaceId, `${encodeURIComponent(selectedHash)}/files`).then(result => {
      if (!cancelled) { setFiles(result.files); setSelectedFile(result.files[0] ?? null); }
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); })
      .finally(() => { if (!cancelled) setLoadingFiles(false); });
    return () => { cancelled = true; };
  }, [selectedHash, workspaceId]);
  useEffect(() => {
    if (!selectedHash || !selectedFile) { setDiff(null); return; }
    let cancelled = false;
    setLoadingDiff(true); setDiff(null); setError('');
    void request<Diff>(workspaceId, 'diff', { hash: selectedHash, path: selectedFile.path, previousPath: selectedFile.previousPath }).then(result => {
      if (!cancelled) setDiff(result);
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); })
      .finally(() => { if (!cancelled) setLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [selectedFile, selectedHash, workspaceId]);

  return <section className="git-history-panel" role="dialog" aria-label="Git History">
    <header><div><h2>Git History</h2><p>Recent commits and file changes · read only</p></div><button aria-label="Close Git History" onClick={onClose}>×</button></header>
    <div className="git-history-body">
      <nav className="git-history-commits" aria-label="Recent commits">
        {loadingCommits && <p role="status">Loading commits…</p>}
        {!loadingCommits && !commits.length && !error && <p>No commits found.</p>}
        {commits.map(commit => <button key={commit.hash} aria-pressed={selectedHash === commit.hash} onClick={() => setSelectedHash(commit.hash)}>
          <strong>{commit.subject || '(no subject)'}</strong><code>{shortHash(commit.hash)}</code><small>{commit.author} · {dateLabel(commit.authoredAt)}</small>
        </button>)}
      </nav>
      <div className="git-history-detail">
        {selectedCommit && <div className="git-history-commit-detail"><h3>{selectedCommit.subject || '(no subject)'}</h3><p>{selectedCommit.author} · {dateLabel(selectedCommit.authoredAt)} · <code>{selectedCommit.hash}</code></p></div>}
        {loadingFiles && <p role="status">Loading changed files…</p>}
        {!loadingFiles && selectedCommit && !files.length && <p>This commit has no file changes.</p>}
        {!!files.length && <div className="git-history-files" aria-label="Changed files">{files.map((file, index) => <button key={`${file.status}:${file.path}:${index}`} aria-pressed={selectedFile === file} onClick={() => setSelectedFile(file)}><span className={`git-history-status status-${file.status[0]}`}>{file.status}</span><span>{file.path}</span></button>)}</div>}
        {loadingDiff && <p role="status">Loading diff…</p>}
        {diff && selectedFile && <div className="git-history-diff" aria-label={`Diff for ${selectedFile.path}`}><div className="git-history-diff-title">{selectedFile.path}{selectedFile.previousPath ? ` ← ${selectedFile.previousPath}` : ''}</div>
          <DiffEditor height="360px" original={diff.before} modified={diff.after} language="plaintext" theme={theme === 'dark' ? 'vs-dark' : 'vs'} options={{ readOnly: true, automaticLayout: true, renderSideBySide: true, minimap: { enabled: false } }} />
        </div>}
        {error && <div role="alert" className="editor-conflict">{error}</div>}
      </div>
    </div>
  </section>;
}

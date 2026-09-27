import { useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { pluginRequest, type PluginEditorProps } from '../types';
import { newCell, OutputReducer, parseNotebook, serializeNotebook, text, type Cell, type ExecutionEvent, type Notebook, type Output } from './model';

export function NotebookEditor({ workspaceId, path, content, onChange, theme }: PluginEditorProps) {
  const parsed = useMemo(() => {
    try { return { notebook: parseNotebook(content), error: '' }; }
    catch (error) { return { notebook: null, error: (error as Error).message }; }
  }, [content]);
  const current = useRef<Notebook | null>(parsed.notebook); current.current = parsed.notebook;
  const change = useRef(onChange); change.current = onChange;
  const [error, setError] = useState('');
  const [status, setStatus] = useState('stopped');
  const [running, setRunning] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void pluginRequest(workspaceId, 'notebooks/status', { path }).then(result => { if (mounted.current) setStatus(result.status); }).catch(() => {});
    return () => { mounted.current = false; cancelled.current = true; controller.current?.abort(); };
  }, [workspaceId, path]);
  function commit(notebook: Notebook) { current.current = notebook; change.current(serializeNotebook(notebook)); }
  function updateCell(id: string, update: Partial<Cell>) {
    if (!current.current || !mounted.current) return;
    commit({ ...current.current, cells: current.current.cells.map(cell => cell.id === id ? { ...cell, ...update } : cell) });
  }
  async function control(action: string) {
    setError('');
    if (action === 'interrupt' || action === 'stop') cancelled.current = true;
    setWorking(true);
    try { const result = await pluginRequest(workspaceId, `notebooks/${action}`, { path }); if (mounted.current) setStatus(result.status); }
    catch (error) { if (mounted.current) setError((error as Error).message); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function executeCell(cell: Cell): Promise<boolean> {
    const reducer = new OutputReducer();
    setRunning(cell.id); setStatus('busy');
    updateCell(cell.id, { outputs: [], execution_count: null });
    const abort = new AbortController(); controller.current = abort;
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/notebooks/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, code: text(cell.source) }), signal: abort.signal,
    });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? 'Execution failed'); }
    if (!response.body) throw new Error('Streaming execution is unavailable');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let done = false;
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const message = JSON.parse(line) as ExecutionEvent;
          if (message.error) throw new Error(message.error);
          if (message.done) done = true;
          else {
            reducer.apply(message);
            updateCell(cell.id, { outputs: reducer.outputs.map(output => ({ ...output })), execution_count: reducer.count });
          }
        }
        if (chunk.done) break;
      }
      if (!done) throw new Error('Connection lost during execution. Saved outputs may be incomplete.');
    } finally { reader.releaseLock(); controller.current = null; }
    return !reducer.failed;
  }
  async function run(ids: string[]) {
    if (busy.current || working) return;
    busy.current = true; cancelled.current = false; setError('');
    try {
      for (const id of ids) {
        if (cancelled.current) break;
        const cell = current.current?.cells.find(cell => cell.id === id);
        if (cell?.cell_type === 'code' && !(await executeCell(cell))) break;
      }
    } catch (error) {
      controller.current?.abort();
      if (mounted.current) setError((error as Error).message);
    } finally {
      busy.current = false;
      if (mounted.current) {
        setRunning(null);
        void pluginRequest(workspaceId, 'notebooks/status', { path }).then(result => { if (mounted.current) setStatus(result.status); }).catch(() => { if (mounted.current) setStatus('unknown'); });
      }
    }
  }
  const notebook = parsed.notebook;
  if (!notebook) return <div className="plugin-error" role="alert">Unable to open notebook: {parsed.error}</div>;
  const unsupported = !!(notebook.metadata.language_info && typeof notebook.metadata.language_info === 'object' && (notebook.metadata.language_info as { name?: string }).name && (notebook.metadata.language_info as { name?: string }).name !== 'python');
  return <section className="notebook-editor" aria-label={`Notebook ${path}`}>
    <div className="notebook-toolbar">
      <span className={`kernel-state ${running ? 'is-running' : ''}`} role="status">Python · {running ? 'running' : status}</span>
      <button disabled={!!running || working || !!unsupported} onClick={() => void control('start')}>Start kernel</button>
      <button disabled={!!running || working || !!unsupported} onClick={() => void run(notebook.cells.map(cell => cell.id))}>Run all</button>
      <button disabled={working || status === 'stopped'} onClick={() => void control('interrupt')}>Interrupt</button>
      <button disabled={!!running || working || status === 'stopped'} onClick={() => void control('restart')}>Restart kernel</button>
      <button disabled={working || status === 'stopped'} onClick={() => void control('stop')}>Shut down</button>
      <button disabled={!!running} onClick={() => commit({ ...notebook, cells: notebook.cells.map(cell => cell.cell_type === 'code' ? { ...cell, outputs: [], execution_count: null } : cell) })}>Clear outputs</button>
    </div>
    {unsupported && <p role="alert" className="plugin-error">This notebook uses another language. This version supports Python execution; you can still edit and save it.</p>}
    {error && <div role="alert" className="plugin-error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="notebook-cells">
      {notebook.cells.map((cell, index) => <NotebookCell key={cell.id} cell={cell} index={index} theme={theme} running={running === cell.id} disabled={!!running || working} canRun={!unsupported} onChange={update => updateCell(cell.id, update)} onRun={() => void run([cell.id])} onDelete={() => commit({ ...notebook, cells: notebook.cells.filter(item => item.id !== cell.id) })} onMove={direction => {
        const cells = [...notebook.cells]; const target = index + direction;
        if (target < 0 || target >= cells.length) return;
        [cells[index], cells[target]] = [cells[target], cells[index]]; commit({ ...notebook, cells });
      }} />)}
      <div className="notebook-add"><button disabled={!!running} onClick={() => commit({ ...notebook, cells: [...notebook.cells, newCell()] })}>+ Code</button><button disabled={!!running} onClick={() => commit({ ...notebook, cells: [...notebook.cells, newCell('markdown')] })}>+ Markdown</button></div>
      <p className="notebook-footnote">Shift+Enter runs a code cell. Save includes outputs. Closing a tab leaves its idle kernel available; use Shut down to release it.</p>
    </div>
  </section>;
}

function NotebookCell({ cell, index, theme, running, disabled, canRun, onChange, onRun, onDelete, onMove }: {
  cell: Cell; index: number; theme: string; running: boolean; disabled: boolean; canRun: boolean;
  onChange: (update: Partial<Cell>) => void; onRun: () => void; onDelete: () => void; onMove: (direction: number) => void;
}) {
  const [preview, setPreview] = useState(cell.cell_type === 'markdown' && !!text(cell.source));
  const source = text(cell.source);
  return <article className={`notebook-cell${running ? ' executing' : ''}`} aria-label={`Cell ${index + 1}`}>
    <div className="notebook-cell-toolbar">
      <span className="cell-count">{cell.cell_type === 'code' ? `[${running ? '*' : cell.execution_count ?? ' '}]` : `${index + 1}`}</span>
      <select aria-label={`Cell ${index + 1} type`} value={cell.cell_type} disabled={disabled} onChange={event => {
        const kind = event.target.value as Cell['cell_type'];
        // Remove code-only fields when converting to Markdown or raw.
        onChange({ cell_type: kind, outputs: kind === 'code' ? [] : undefined, execution_count: kind === 'code' ? null : undefined });
        setPreview(false);
      }}><option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option></select>
      {cell.cell_type === 'code' && <button disabled={disabled || !canRun} onClick={onRun} aria-label={`Run cell ${index + 1}`}>▶ Run</button>}
      {cell.cell_type === 'markdown' && <button onClick={() => setPreview(!preview)}>{preview ? 'Edit Markdown' : 'Preview Markdown'}</button>}
      <span className="cell-toolbar-spacer" />
      <button disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={`Move cell ${index + 1} up`}>↑</button>
      <button disabled={disabled} onClick={() => onMove(1)} aria-label={`Move cell ${index + 1} down`}>↓</button>
      <button disabled={disabled} onClick={onDelete} aria-label={`Delete cell ${index + 1}`}>Delete</button>
    </div>
    {cell.cell_type === 'markdown' && preview ? <div className="notebook-markdown" onDoubleClick={() => setPreview(false)}><ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown></div> :
      <div className="notebook-cell-input" onKeyDown={event => { if (event.shiftKey && event.key === 'Enter' && cell.cell_type === 'code') { event.preventDefault(); if (!disabled && canRun) onRun(); } }}>
        <MonacoEditor height={Math.min(500, Math.max(100, (source.split('\n').length + 1) * 21))} language={cell.cell_type === 'code' ? 'python' : cell.cell_type === 'markdown' ? 'markdown' : 'plaintext'} theme={theme === 'dark' ? 'vs-dark' : 'vs'} value={source} options={{ automaticLayout: true, readOnly: disabled, autoClosingBrackets: 'never', autoClosingQuotes: 'never', quickSuggestions: false, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', fontSize: 13, padding: { top: 10 }, overviewRulerLanes: 0 }} onChange={value => onChange({ source: value ?? '' })} />
      </div>}
    {!!cell.outputs?.length && <div className="notebook-outputs">{cell.outputs.map((output, i) => <NotebookOutput key={i} output={output} />)}</div>}
  </article>;
}

function NotebookOutput({ output }: { output: Output }) {
  if (output.output_type === 'stream') return <pre className={output.name === 'stderr' ? 'notebook-stderr' : ''}>{text(output.text)}</pre>;
  if (output.output_type === 'error') return <pre className="notebook-stderr">{(output.traceback?.join('\n') || `${output.ename}: ${output.evalue}`).replace(/\x1b\[[0-9;]*m/g, '')}</pre>;
  const data = output.data ?? {};
  if (data['image/png'] || data['image/jpeg']) { const mime = data['image/png'] ? 'image/png' : 'image/jpeg'; return <img alt="Notebook output" src={`data:${mime};base64,${text(data[mime]).replace(/\s/g, '')}`} />; }
  if (data['text/html']) return <iframe title="Notebook HTML output" sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><style>body{font:13px system-ui;color:#222}table{border-collapse:collapse}td,th{padding:6px 10px;border:1px solid #ddd}</style>${text(data['text/html'])}`} />;
  if (data['text/markdown']) return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text(data['text/markdown'])}</ReactMarkdown>;
  if (data['text/plain']) return <pre>{text(data['text/plain'])}</pre>;
  if (data['application/json']) return <pre>{JSON.stringify(data['application/json'], null, 2)}</pre>;
  return <p className="notebook-footnote">This output type is preserved but cannot be displayed in this version.</p>;
}

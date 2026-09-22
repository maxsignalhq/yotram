import { useEffect, useRef, useState } from 'react';
interface Selection { url: string; viewport: { width: number; height: number }; html: string; styles: Record<string, string>; source?: string; screenshot?: string; captureError?: string }
export function Preview({ workspaceId, initialPort, onPortChange }: { workspaceId: string; initialPort?: number; onPortChange?: (port: number) => void }) {
  const [port, setPort] = useState(String(initialPort ?? 3000));
  const [url, setUrl] = useState('');
  const [inspect, setInspect] = useState(false);
  const [ready, setReady] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const valid = /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && port !== window.location.port;
  useEffect(() => { if (initialPort) setPort(String(initialPort)); }, [initialPort]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!url || event.source !== frame.current?.contentWindow || event.origin !== new URL(url).origin) return;
      if (event.data?.type === 'yotram:inspector-ready') setReady(true);
      if (event.data?.type === 'yotram:selection') {
        const value = event.data.context;
        if (typeof value?.html !== 'string' || typeof value?.url !== 'string' || JSON.stringify(value).length > 8 * 1024 * 1024) return;
        setSelection(value); setSelecting(false);
      }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [url]);
  async function load() {
    setBusy(true); setError(''); setReady(false); setSelection(null); onPortChange?.(Number(port));
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: Number(port), inspect }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      const address = new URL(window.location.origin); address.port = String(result.port); address.searchParams.set('__yotram_preview', result.ticket); setUrl(address.href);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const task = selection ? `${request}\n\nPage: ${selection.url}\nViewport: ${JSON.stringify(selection.viewport)}\nElement:\n${selection.html}\nStyles:\n${JSON.stringify(selection.styles, null, 2)}${selection.source ? `\nSource hint: ${selection.source}` : ''}` : '';
  function download() {
    const blob = new Blob([JSON.stringify({ request, context: selection }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'yotram-preview-task.json'; link.click(); URL.revokeObjectURL(link.href);
  }
  return <section className="preview-panel" aria-label="App preview">
    <form className="pane-toolbar" onSubmit={event => { event.preventDefault(); if (valid) void load(); }}>
      <label htmlFor="preview-port">Port</label><input id="preview-port" type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} />
      <button disabled={!valid || busy}>Load preview</button>{url && <a href={new URL('/', url).href} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
    </form>
    <label className="preview-option"><input type="checkbox" checked={inspect} onChange={event => setInspect(event.target.checked)} /> Enable element capture on next load</label>
    {error && <p role="alert">{error}</p>}
    {inspect && <div className="pane-toolbar"><button disabled={!ready} onClick={() => { setSelecting(!selecting); frame.current?.contentWindow?.postMessage({ type: 'yotram:select', active: !selecting }, new URL(url).origin); }}>{selecting ? 'Cancel selection' : 'Select element'}</button><span>{ready ? 'Click an element to prepare a task.' : 'Load preview to connect the helper. App CSP may block capture.'}</span></div>}
    {!url && <p>Start your app in a terminal and enter its port. Preview connects to the Yotram server’s machine from any device on your network.</p>}
    {url && <iframe ref={frame} title="Local app preview" src={url} sandbox="allow-scripts allow-forms allow-same-origin" />}
    {selection && <div className="capture-card"><h3>Review captured context</h3><p>Screenshots can contain private page content. Remove anything you do not want to share.</p>
      {selection.screenshot?.startsWith('data:image/png;base64,') && <><img alt="Captured app viewport" src={selection.screenshot} /><button onClick={() => setSelection({ ...selection, screenshot: undefined })}>Remove screenshot</button></>}
      {selection.captureError && <p>{selection.captureError}</p>}
      <label>Task request<textarea value={request} onChange={event => setRequest(event.target.value)} placeholder="What should change?" /></label>
      <label>Element context<textarea value={selection.html} onChange={event => setSelection({ ...selection, html: event.target.value })} /></label>
      <details><summary>Styles and page context</summary><pre>{JSON.stringify({ ...selection, html: undefined, screenshot: undefined }, null, 2)}</pre></details>
      <textarea aria-label="Prepared task" readOnly value={task} />
      <button onClick={() => { navigator.clipboard?.writeText(task).then(() => setCopied(true)).catch(() => setError('Clipboard unavailable. Select and copy the prepared task above.')); }}>{copied ? 'Copied' : 'Copy task text'}</button><button onClick={download}>Download task + screenshot</button><button onClick={() => setSelection(null)}>Discard capture</button>
    </div>}
  </section>;
}

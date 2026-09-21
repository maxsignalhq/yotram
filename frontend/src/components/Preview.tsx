import { useState } from 'react';
export function Preview() {
  const [port, setPort] = useState('3000');
  const [url, setUrl] = useState('');
  const [revision, setRevision] = useState(0);
  const valid = /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && port !== window.location.port;
  const remote = window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost';
  return <section className="preview-panel" aria-label="App preview">
    <form className="pane-toolbar" onSubmit={event => { event.preventDefault(); if (valid) { setUrl(`http://127.0.0.1:${Number(port)}/`); setRevision(value => value + 1); } }}>
      <label htmlFor="preview-port">Port</label><input id="preview-port" type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} />
      <button disabled={!valid}>Load preview</button>{url && <a href={url} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
    </form>
    {remote && <p role="note" className="preview-notice">You're viewing Yotram from another device on the network. Preview looks for your app on <em>this</em> device's own localhost, not the Yotram server's machine — it likely won't work here. Use Yotram from the machine running the server for a working preview.</p>}
    <p>Start your app in the terminal, then enter its port. For the starter project, run <code>node server.cjs</code>. Reload the preview after edits. If embedding is blocked, open it in a new tab.</p>
    {url && <iframe key={revision} title="Local app preview" src={url} sandbox="allow-scripts allow-forms" />}
  </section>;
}

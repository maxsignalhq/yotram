import { useEffect, useRef, useState } from 'react';
import type { WsClient } from '../wsClient';
interface Entry { name: string; isDirectory: boolean }
export function FileTree({ client, onOpenFile }: { client: WsClient; onOpenFile: (path: string) => void }) {
  const [listings, setListings] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [selected, setSelected] = useState('.');
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => { for (const path of expandedRef.current) client.send({ type: 'fs:list', path }); };
    const subscriptions = [
      client.on('fs:list', msg => setListings(previous => ({ ...previous, [msg.path]: msg.entries }))),
      client.on('fs:updated', refresh), client.on('fs:watch-event', refresh),
      client.on('fs:error', msg => setError(`${msg.path}: ${msg.message}`)),
    ];
    const status = client.onStatusChange?.(value => { if (value === 'open') refresh(); });
    refresh();
    return () => { subscriptions.forEach(fn => fn()); status?.(); };
  }, [client]);
  function create(directory: boolean) {
    const path = window.prompt(`New ${directory ? 'folder' : 'file'} path, relative to project root:`);
    if (path) client.send({ type: 'fs:create', path, directory });
  }
  function tree(parent: string): React.ReactNode {
    return <ul className="filetree-list">{[...(listings[parent] ?? [])].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)).map(entry => {
      const path = parent === '.' ? entry.name : `${parent}/${entry.name}`;
      return <li key={path}><button className="filetree-entry-button" aria-current={selected === path ? 'true' : undefined} aria-expanded={entry.isDirectory ? expanded.has(path) : undefined} onClick={() => {
        setSelected(path);
        if (!entry.isDirectory) { onOpenFile(path); return; }
        const next = new Set(expanded);
        if (next.has(path)) next.delete(path); else { next.add(path); client.send({ type: 'fs:list', path }); }
        setExpanded(next);
      }}>{entry.isDirectory ? (expanded.has(path) ? '▾ ' : '▸ ') : ''}{entry.name}</button>{entry.isDirectory && expanded.has(path) && tree(path)}</li>;
    })}</ul>;
  }
  return <>
    <div className="pane-toolbar"><button onClick={() => create(false)}>New file</button><button onClick={() => create(true)}>New folder</button></div>
    <div className="pane-toolbar"><button disabled={selected === '.'} onClick={() => {
      const destination = window.prompt('Rename to path:', selected);
      if (destination && destination !== selected) client.send({ type: 'fs:rename', path: selected, destination });
    }}>Rename</button><button disabled={selected === '.'} onClick={() => {
      if (window.confirm(`Delete ${selected}? Folders must be empty.`)) client.send({ type: 'fs:delete', path: selected });
    }}>Delete</button></div>
    {error && <div role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {tree('.')}
  </>;
}

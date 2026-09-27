import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WsClient } from '../wsClient';
import { getFileIcon } from '../icons';
interface Entry { name: string; isDirectory: boolean }
export function FileTree({ client, onOpenFile }: { client: WsClient; onOpenFile: (path: string) => void }) {
  const [listings, setListings] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [selected, setSelected] = useState('.');
  const [error, setError] = useState('');
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  function endDrag() { dragged.current = null; setDragging(null); setDropTarget(null); }
  function destinationFor(folder: string) {
    const source = dragged.current;
    if (!source || folder === source || folder.startsWith(source + '/')) return null;
    const destination = (folder === '.' ? '' : folder + '/') + source.split('/').pop();
    return destination === source ? null : destination;
  }
  function dropHandlers(folder: string) {
    return {
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!destinationFor(folder)) { event.dataTransfer.dropEffect = 'none'; return; }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(folder);
      },
      onDragLeave: () => setDropTarget(current => current === folder ? null : current),
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault(); event.stopPropagation();
        const destination = destinationFor(folder);
        if (destination && dragged.current) {
          setError('');
          client.send({ type: 'fs:rename', path: dragged.current, destination });
        }
        endDrag();
      },
    };
  }
  useEffect(() => {
    const refresh = () => { for (const path of expandedRef.current) client.send({ type: 'fs:list', path }); };
    const subscriptions = [
      client.on('fs:list', msg => setListings(previous => ({ ...previous, [msg.path]: msg.entries }))),
      client.on('fs:updated', msg => {
        setError('');
        if (msg.operation === 'rename' && msg.destination) {
          const destination = msg.destination;
          const remap = (path: string) => path === msg.path || path.startsWith(msg.path + '/') ? destination + path.slice(msg.path.length) : path;
          const next = new Set([...expandedRef.current].map(remap));
          const parent = destination.includes('/') ? destination.slice(0, destination.lastIndexOf('/')) : '.';
          // Reveal the destination, including ancestors of paths entered via Rename.
          const parts = parent === '.' ? [] : parent.split('/');
          for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'));
          expandedRef.current = next;
          setExpanded(next);
          setSelected(current => remap(current));
          setListings(previous => Object.fromEntries(Object.entries(previous).map(([path, entries]) => [remap(path), entries])));
        }
        refresh();
      }), client.on('fs:watch-event', refresh),
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
      const Icon = getFileIcon(entry.name, entry.isDirectory);
      return <li key={path}><button className={`filetree-entry-button${dragging === path ? ' is-dragging' : ''}${dropTarget === path ? ' is-drop-target' : ''}`} draggable
        onDragStart={event => {
          dragged.current = path; setDragging(path); setSelected(path);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-yotram-path', path);
        }} onDragEnd={endDrag} {...(entry.isDirectory ? dropHandlers(path) : {})} aria-current={selected === path ? 'true' : undefined} aria-expanded={entry.isDirectory ? expanded.has(path) : undefined} onClick={() => {
        setSelected(path);
        if (!entry.isDirectory) { onOpenFile(path); return; }
        const next = new Set(expanded);
        if (next.has(path)) next.delete(path); else { next.add(path); client.send({ type: 'fs:list', path }); }
        setExpanded(next);
      }}>{entry.isDirectory ? (expanded.has(path) ? '▾ ' : '▸ ') : ''}<Icon className="filetree-entry-icon" />{entry.name}</button>{entry.isDirectory && expanded.has(path) && tree(path)}</li>;
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
    <button className={`filetree-entry-button filetree-root${dropTarget === '.' ? ' is-drop-target' : ''}`} {...dropHandlers('.')} onClick={() => setSelected('.')} title="Drop files or folders here to move them to the project root">Project root</button>
    {tree('.')}
  </>;
}

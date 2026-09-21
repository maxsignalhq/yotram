import { useEffect, useRef, useState } from 'react';
interface Listing { path: string; parent: string; folders: string[] }
export function FolderPicker({ create, busy, error, onSelect, onClose }: {
  create: boolean; busy: boolean; error: string; onSelect: (path: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [location, setLocation] = useState('');
  const [name, setName] = useState('my-app');
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const requestId = useRef(0);
  async function browse(path = '') {
    const id = ++requestId.current;
    setLoading(true); setBrowseError('');
    try {
      const response = await fetch(`/api/folders?path=${encodeURIComponent(path)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to read folder');
      if (id === requestId.current) { setListing(result); setLocation(result.path); }
    } catch (error) { if (id === requestId.current) setBrowseError(error instanceof TypeError ? 'Cannot connect to Yotram. Check that the local server is running.' : (error as Error).message); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void browse(); return () => { requestId.current++; }; }, []);
  const validName = name.trim() !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);
  const join = (parent: string, child: string) => `${parent.replace(/\/$/, '')}/${child}`;
  return <dialog ref={dialog} className="folder-picker" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2>{create ? 'Create starter project' : 'Open folder'}</h2>
    <p>{create ? 'Choose where to create your project, then give it a name.' : 'Choose a folder on this Mac to open.'}</p>
    <form onSubmit={event => { event.preventDefault(); void browse(location); }} className="folder-location">
      <label htmlFor="folder-location">Folder location</label><input id="folder-location" value={location} onChange={event => setLocation(event.target.value)} />
      <button disabled={loading || busy}>Go</button>
    </form>
    <button disabled={!listing || loading || busy || listing.path === listing.parent} onClick={() => listing && void browse(listing.parent)}>Up one folder</button>
    {(browseError || error) && <p role="alert" className="editor-conflict">{browseError || error}</p>}
    <div className="folder-options" aria-busy={loading}>
      {loading ? <p role="status">Loading folders…</p> : listing?.folders.map(folder => <button key={folder} disabled={busy} onClick={() => void browse(join(listing.path, folder))}>▸ {folder}</button>)}
      {!loading && listing?.folders.length === 0 && <p>No subfolders. You can select this folder.</p>}
    </div>
    {create && <label className="project-name">Project name<input autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>}
    <p className="project-path">{listing && (create ? join(listing.path, name.trim()) : listing.path)}</p>
    <div className="dashboard-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || loading || !listing || (create && !validName)} onClick={() => listing && onSelect(create ? join(listing.path, name.trim()) : listing.path)}>{busy ? 'Opening…' : create ? 'Create project' : 'Open selected folder'}</button></div>
  </dialog>;
}

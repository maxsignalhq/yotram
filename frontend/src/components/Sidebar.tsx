import { useState } from 'react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';

export function Sidebar({ client, onOpenFile, theme = 'dark', onToggleTheme = () => {} }: {
  client: WsClient; onOpenFile: (path: string) => void; theme?: Theme; onToggleTheme?: () => void;
}) {
  const [tab, setTab] = useState<'files' | 'git'>('files');
  const [gitOpened, setGitOpened] = useState(false);
  function selectTab(next: 'files' | 'git') {
    setTab(next);
    if (next === 'git') setGitOpened(true);
  }
  return <aside className="filetree">
    <div className="filetree-header">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
        <button role="tab" aria-selected={tab === 'files'} onClick={() => selectTab('files')}>Files</button>
        <button role="tab" aria-selected={tab === 'git'} onClick={() => selectTab('git')}>Git</button>
      </div>
      <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>◐</button>
    </div>
    <div hidden={tab !== 'files'}><FileTree client={client} onOpenFile={onOpenFile} /></div>
    {gitOpened && <div hidden={tab !== 'git'}><GitPanel client={client} theme={theme} /></div>}
  </aside>;
}

import { useState } from 'react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { SessionsPanel } from './SessionsPanel';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';

export function Sidebar({ client, onOpenFile, theme = 'dark', onToggleTheme = () => {}, workspacePath, onResumeSession, initialTab }: {
  client: WsClient; onOpenFile: (path: string) => void; theme?: Theme; onToggleTheme?: () => void;
  workspacePath: string; onResumeSession: (command: string) => void; initialTab?: 'files' | 'git' | 'sessions';
}) {
  const [tab, setTab] = useState<'files' | 'git' | 'sessions'>(initialTab ?? 'files');
  const [gitOpened, setGitOpened] = useState(initialTab === 'git');
  const [sessionsOpened, setSessionsOpened] = useState(initialTab === 'sessions');
  // Bumped every time the Sessions tab is (re-)selected, and passed as
  // SessionsPanel's `key`. SessionsPanel only fetches on mount, and the
  // lazy-mount-then-`hidden` pattern below would otherwise leave it mounted
  // once and never re-fetch on subsequent tab switches; changing `key`
  // forces React to unmount/remount it, re-running its fetch effect, so a
  // session started after the first open still shows up.
  const [sessionsOpenCount, setSessionsOpenCount] = useState(0);
  function selectTab(next: 'files' | 'git' | 'sessions') {
    setTab(next);
    if (next === 'git') setGitOpened(true);
    if (next === 'sessions') { setSessionsOpened(true); setSessionsOpenCount(count => count + 1); }
    client.send({ type: 'view:update', patch: { sidebarTab: next } });
  }
  return <aside className="filetree">
    <div className="filetree-header">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
        <button role="tab" aria-selected={tab === 'files'} onClick={() => selectTab('files')}>Files</button>
        <button role="tab" aria-selected={tab === 'git'} onClick={() => selectTab('git')}>Git</button>
        <button role="tab" aria-selected={tab === 'sessions'} onClick={() => selectTab('sessions')}>Sessions</button>
      </div>
      <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>◐</button>
    </div>
    <div hidden={tab !== 'files'}><FileTree client={client} onOpenFile={onOpenFile} /></div>
    {gitOpened && <div hidden={tab !== 'git'}><GitPanel client={client} theme={theme} /></div>}
    {sessionsOpened && <div hidden={tab !== 'sessions'}><SessionsPanel key={sessionsOpenCount} workspacePath={workspacePath} onResume={onResumeSession} /></div>}
  </aside>;
}

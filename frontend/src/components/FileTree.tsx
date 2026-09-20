import { useEffect, useState } from 'react';
import type { WsClient } from '../wsClient';
import type { Theme } from '../theme';
import { FileIcon, FolderIcon, MoonIcon, SunIcon } from '../icons';

interface Entry { name: string; isDirectory: boolean }

export function FileTree({
  client,
  onOpenFile,
  theme = 'dark',
  onToggleTheme = () => {},
}: {
  client: WsClient;
  onOpenFile: (path: string) => void;
  theme?: Theme;
  onToggleTheme?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const unsubscribe = client.on('fs:list', (msg) => {
      if (msg.path === '.') setEntries(msg.entries);
    });
    client.send({ type: 'fs:list', path: '.' });
    return unsubscribe;
  }, [client]);

  return (
    <div className="filetree">
      <div className="filetree-header">
        <span>Explorer</span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      <ul className="filetree-list">
        {entries.map((entry) => (
          <li key={entry.name}>
            {entry.isDirectory ? (
              <span className="filetree-entry-label">
                <FolderIcon className="filetree-entry-icon" />
                <span>{entry.name}</span>
              </span>
            ) : (
              <button className="filetree-entry-button" onClick={() => onOpenFile(entry.name)}>
                <FileIcon className="filetree-entry-icon" />
                <span>{entry.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

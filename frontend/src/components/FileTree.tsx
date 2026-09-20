import { useEffect, useState } from 'react';
import type { WsClient } from '../wsClient';

interface Entry { name: string; isDirectory: boolean }

export function FileTree({ client, onOpenFile }: { client: WsClient; onOpenFile: (path: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const unsubscribe = client.on('fs:list', (msg) => {
      if (msg.path === '.') setEntries(msg.entries);
    });
    client.send({ type: 'fs:list', path: '.' });
    return unsubscribe;
  }, [client]);

  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.name}>
          {entry.isDirectory ? (
            <span>{entry.name}/</span>
          ) : (
            <button onClick={() => onOpenFile(entry.name)}>{entry.name}</button>
          )}
        </li>
      ))}
    </ul>
  );
}

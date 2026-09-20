import { useEffect, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { WsClient } from '../wsClient';

export function Editor({ client, path }: { client: WsClient; path: string | null }) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [conflict, setConflict] = useState(false);

  // Refs mirror the latest state so the fs:watch-event handler (registered once
  // per path in the effect below) never reads stale closed-over values.
  const contentRef = useRef(content);
  const savedContentRef = useRef(savedContent);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { savedContentRef.current = savedContent; }, [savedContent]);

  useEffect(() => {
    if (!path) return;
    const unsubRead = client.on('fs:read', (msg) => {
      if (msg.path === path) {
        setContent(msg.content);
        setSavedContent(msg.content);
        setConflict(false);
      }
    });
    const unsubWatch = client.on('fs:watch-event', (msg) => {
      if (msg.path === path && msg.kind === 'change' && contentRef.current !== savedContentRef.current) {
        setConflict(true);
      }
    });
    client.send({ type: 'fs:read', path });
    return () => { unsubRead(); unsubWatch(); };
  }, [client, path]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (path) {
          client.send({ type: 'fs:write', path, content });
          setSavedContent(content);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [client, path, content]);

  if (!path) return <div>No file open</div>;

  return (
    <div>
      {conflict && (
        <div role="alert">
          file changed on disk — reload or keep mine?
          <button onClick={() => { client.send({ type: 'fs:read', path }); setConflict(false); }}>Reload</button>
          <button onClick={() => setConflict(false)}>Keep mine</button>
        </div>
      )}
      <MonacoEditor value={content} onChange={(value: string | undefined) => setContent(value ?? '')} />
    </div>
  );
}

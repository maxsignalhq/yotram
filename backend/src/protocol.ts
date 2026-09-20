export interface FsListMessage { type: 'fs:list'; path: string }
export interface FsReadMessage { type: 'fs:read'; path: string }
export interface FsWriteMessage { type: 'fs:write'; path: string; content: string }
export interface PtyCreateMessage { type: 'pty:create'; sessionId: string; cols: number; rows: number }
export interface PtyDataMessage { type: 'pty:data'; sessionId: string; data: string }
export interface PtyResizeMessage { type: 'pty:resize'; sessionId: string; cols: number; rows: number }

export type ClientMessage =
  | FsListMessage
  | FsReadMessage
  | FsWriteMessage
  | PtyCreateMessage
  | PtyDataMessage
  | PtyResizeMessage;

export interface FsListResultMessage { type: 'fs:list'; path: string; entries: { name: string; isDirectory: boolean }[] }
export interface FsReadResultMessage { type: 'fs:read'; path: string; content: string }
export interface FsWatchEventMessage { type: 'fs:watch-event'; path: string; kind: 'add' | 'change' | 'unlink' }
export interface FsErrorMessage { type: 'fs:error'; path: string; message: string }
export interface PtyDataResultMessage { type: 'pty:data'; sessionId: string; data: string }
export interface PtyExitMessage { type: 'pty:exit'; sessionId: string; exitCode: number }

export type ServerMessage =
  | FsListResultMessage
  | FsReadResultMessage
  | FsWatchEventMessage
  | FsErrorMessage
  | PtyDataResultMessage
  | PtyExitMessage;

const CLIENT_MESSAGE_TYPES = new Set([
  'fs:list', 'fs:read', 'fs:write', 'pty:create', 'pty:data', 'pty:resize',
]);

export function isClientMessage(x: unknown): x is ClientMessage {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    typeof (x as { type: unknown }).type === 'string' &&
    CLIENT_MESSAGE_TYPES.has((x as { type: string }).type)
  );
}

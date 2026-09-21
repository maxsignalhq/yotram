export interface FsListMessage { type: 'fs:list'; path: string }
export interface FsReadMessage { type: 'fs:read'; path: string }
export interface FsWriteMessage { type: 'fs:write'; path: string; content: string }
export interface PtyCreateMessage { type: 'pty:create'; sessionId: string; cols: number; rows: number }
export interface PtyDataMessage { type: 'pty:data'; sessionId: string; data: string }
export interface PtyResizeMessage { type: 'pty:resize'; sessionId: string; cols: number; rows: number }
export interface GitStatusMessage { type: 'git:status' }
export interface GitDiffMessage { type: 'git:diff'; path: string; staged: boolean }
export interface GitStageMessage { type: 'git:stage'; path: string }
export interface GitUnstageMessage { type: 'git:unstage'; path: string }
export interface GitCommitMessage { type: 'git:commit'; message: string }
export interface GitBranchesMessage { type: 'git:branches' }
export interface GitCheckoutMessage { type: 'git:checkout'; name: string }

export type ClientMessage =
  | { type: 'fs:create'; path: string; directory: boolean }
  | { type: 'fs:rename'; path: string; destination: string }
  | { type: 'fs:delete'; path: string }
  | { type: 'pty:kill'; sessionId: string }
  | FsListMessage
  | FsReadMessage
  | FsWriteMessage
  | PtyCreateMessage
  | PtyDataMessage
  | PtyResizeMessage
  | GitStatusMessage
  | GitDiffMessage
  | GitStageMessage
  | GitUnstageMessage
  | GitCommitMessage
  | GitBranchesMessage
  | GitCheckoutMessage;

export interface FsListResultMessage { type: 'fs:list'; path: string; entries: { name: string; isDirectory: boolean }[] }
export interface FsReadResultMessage { type: 'fs:read'; path: string; content: string }
export interface FsWatchEventMessage { type: 'fs:watch-event'; path: string; kind: 'add' | 'change' | 'unlink' }
export interface FsErrorMessage { type: 'fs:error'; path: string; message: string }
export interface PtyDataResultMessage { type: 'pty:data'; sessionId: string; data: string }
export interface PtyExitMessage { type: 'pty:exit'; sessionId: string; exitCode: number }
export interface GitStatusResultMessage { type: 'git:status'; isRepo: boolean; branch: string | null; staged: string[]; unstaged: string[]; untracked: string[] }
export interface GitDiffResultMessage { type: 'git:diff'; path: string; staged: boolean; before: string; after: string }
export interface GitBranchesResultMessage { type: 'git:branches'; branches: { name: string; current: boolean }[] }
export interface GitErrorMessage { type: 'git:error'; message: string }

export type ServerMessage =
  | { type: 'fs:saved'; path: string; content: string }
  | { type: 'fs:updated'; path: string; destination?: string; operation: 'create' | 'rename' | 'delete' }
  | FsListResultMessage
  | FsReadResultMessage
  | FsWatchEventMessage
  | FsErrorMessage
  | PtyDataResultMessage
  | PtyExitMessage
  | GitStatusResultMessage
  | GitDiffResultMessage
  | GitBranchesResultMessage
  | GitErrorMessage;

export function isClientMessage(x: unknown): x is ClientMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  const str = (key: string) => typeof m[key] === 'string';
  const size = (key: string) => Number.isInteger(m[key]) && Number(m[key]) > 0 && Number(m[key]) <= 1000;
  switch (m.type) {
    case 'fs:list': case 'fs:read': case 'fs:delete': return str('path');
    case 'fs:write': return str('path') && str('content');
    case 'fs:create': return str('path') && typeof m.directory === 'boolean';
    case 'fs:rename': return str('path') && str('destination');
    case 'pty:create': case 'pty:resize': return str('sessionId') && size('cols') && size('rows');
    case 'pty:data': return str('sessionId') && str('data');
    case 'pty:kill': return str('sessionId');
    case 'git:status': case 'git:branches': return true;
    case 'git:diff': return str('path') && typeof m.staged === 'boolean';
    case 'git:stage': case 'git:unstage': return str('path');
    case 'git:commit': return str('message');
    case 'git:checkout': return str('name');
    default: return false;
  }
}

export type ClientMessage =
  | { type: 'fs:list'; path: string }
  | { type: 'fs:read'; path: string }
  | { type: 'fs:write'; path: string; content: string }
  | { type: 'pty:create'; sessionId: string; cols: number; rows: number }
  | { type: 'pty:data'; sessionId: string; data: string }
  | { type: 'pty:resize'; sessionId: string; cols: number; rows: number };

export type ServerMessage =
  | { type: 'fs:list'; path: string; entries: { name: string; isDirectory: boolean }[] }
  | { type: 'fs:read'; path: string; content: string }
  | { type: 'fs:watch-event'; path: string; kind: 'add' | 'change' | 'unlink' }
  | { type: 'fs:error'; path: string; message: string }
  | { type: 'pty:data'; sessionId: string; data: string }
  | { type: 'pty:exit'; sessionId: string; exitCode: number };

type Status = 'connecting' | 'open' | 'closed';

export class WsClient {
  private socket: WebSocket;
  private handlers = new Map<string, Set<(msg: ServerMessage) => void>>();
  private statusHandlers = new Set<(status: Status) => void>();
  private backoffMs = 500;
  private closedByUser = false;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.socket = this.connect();
  }

  private connect(): WebSocket {
    this.setStatus('connecting');
    const socket = new WebSocket(this.url);
    socket.onopen = () => {
      this.backoffMs = 500;
      this.setStatus('open');
    };
    socket.onmessage = (event: { data: string }) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      for (const handler of this.handlers.get(msg.type) ?? []) handler(msg);
    };
    socket.onclose = () => {
      this.setStatus('closed');
      if (!this.closedByUser) {
        setTimeout(() => { this.socket = this.connect(); }, this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, 5000);
      }
    };
    return socket;
  }

  private setStatus(status: Status): void {
    for (const handler of this.statusHandlers) handler(status);
  }

  send(msg: ClientMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  on<T extends ServerMessage['type']>(
    type: T,
    handler: (msg: Extract<ServerMessage, { type: T }>) => void,
  ): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as (msg: ServerMessage) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (msg: ServerMessage) => void);
  }

  onStatusChange(handler: (status: Status) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  close(): void {
    this.closedByUser = true;
    this.socket.close();
  }
}

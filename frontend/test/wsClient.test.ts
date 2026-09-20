import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsClient } from '../src/wsClient';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error test stub
  globalThis.WebSocket = FakeWebSocket;
});

describe('WsClient', () => {
  it('dispatches messages to type-specific handlers', () => {
    const client = new WsClient('ws://localhost:1234');
    const socket = FakeWebSocket.instances[0];
    const received: any[] = [];
    client.on('fs:read', (msg) => received.push(msg));
    socket.onmessage?.({ data: JSON.stringify({ type: 'fs:read', path: 'a.txt', content: 'hi' }) });
    expect(received).toEqual([{ type: 'fs:read', path: 'a.txt', content: 'hi' }]);
  });

  it('serializes and sends outgoing messages', () => {
    const client = new WsClient('ws://localhost:1234');
    const socket = FakeWebSocket.instances[0];
    client.send({ type: 'fs:read', path: 'a.txt' });
    expect(socket.sent).toEqual([JSON.stringify({ type: 'fs:read', path: 'a.txt' })]);
  });
});

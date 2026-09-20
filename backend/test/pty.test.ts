import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { PtyManager } from '../src/pty.js';

describe('PtyManager', () => {
  it('runs a command and streams its output', async () => {
    const manager = new PtyManager();
    let output = '';
    let exited: number | undefined;
    manager.create('s1', 80, 24, (data) => { output += data; }, (code) => { exited = code; });
    manager.write('s1', 'echo hello-pty\r');
    await sleep(500);
    manager.kill('s1');
    await sleep(200);
    expect(output).toContain('hello-pty');
  });
});

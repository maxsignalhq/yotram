import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('defaults to port 4287 and host 0.0.0.0 with the cwd as root', () => {
    const result = parseArgs([]);
    expect(result.port).toBe(4287);
    expect(result.host).toBe('0.0.0.0');
    expect(result.rootDir).toBe(process.cwd());
  });

  it('parses a directory argument, --port, and --host together', () => {
    const result = parseArgs(['/tmp/project', '--port', '5000', '--host', '127.0.0.1']);
    expect(result.port).toBe(5000);
    expect(result.host).toBe('127.0.0.1');
    expect(result.rootDir).toBe(path.resolve('/tmp/project'));
  });

  it('parses flags in either order relative to the directory argument', () => {
    const result = parseArgs(['--host', '127.0.0.1', '--port', '5000', '/tmp/project']);
    expect(result.port).toBe(5000);
    expect(result.host).toBe('127.0.0.1');
    expect(result.rootDir).toBe(path.resolve('/tmp/project'));
  });

  it('omitting --host still parses --port and the directory correctly', () => {
    const result = parseArgs(['/tmp/project', '--port', '5000']);
    expect(result.port).toBe(5000);
    expect(result.host).toBe('0.0.0.0');
    expect(result.rootDir).toBe(path.resolve('/tmp/project'));
  });
});

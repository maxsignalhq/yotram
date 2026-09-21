import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Auth, loadPassword } from '../src/auth.js';

describe('Auth', () => {
  it('accepts the correct password and rejects a wrong one', () => {
    const auth = new Auth('correct-horse');
    expect(auth.checkPassword('correct-horse')).toBe(true);
    expect(auth.checkPassword('wrong')).toBe(false);
    expect(auth.checkPassword(undefined)).toBe(false);
  });

  it('issues a session token that verifies for the same password', () => {
    const auth = new Auth('correct-horse');
    const token = auth.createSessionToken();
    expect(auth.verifySessionToken(token)).toBe(true);
  });

  it('rejects a token signed with a different password', () => {
    const token = new Auth('correct-horse').createSessionToken();
    expect(new Auth('other-password').verifySessionToken(token)).toBe(false);
  });

  it('rejects a malformed or missing token', () => {
    const auth = new Auth('correct-horse');
    expect(auth.verifySessionToken(undefined)).toBe(false);
    expect(auth.verifySessionToken('garbage')).toBe(false);
  });

  it('rejects an expired token', () => {
    const auth = new Auth('correct-horse');
    const originalNow = Date.now;
    Date.now = () => originalNow() - 1000 * 60 * 60 * 24 * 91;
    const expiredToken = auth.createSessionToken();
    Date.now = originalNow;
    expect(auth.verifySessionToken(expiredToken)).toBe(false);
  });
});

describe('loadPassword', () => {
  it('prefers YOTRAM_PASSWORD from the environment', () => {
    expect(loadPassword({ YOTRAM_PASSWORD: 'from-env' } as NodeJS.ProcessEnv)).toBe('from-env');
  });

  it('falls back to the config file when the env var is unset', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yotram-config-'));
    const configPath = path.join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ password: 'from-file' }));
    try {
      expect(loadPassword({} as NodeJS.ProcessEnv, configPath)).toBe('from-file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when nothing is configured', () => {
    expect(() => loadPassword({} as NodeJS.ProcessEnv, '/nonexistent/config.json')).toThrow(/No password configured/);
  });
});

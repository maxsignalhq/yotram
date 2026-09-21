import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const SESSION_COOKIE_NAME = 'yotram_session';
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;

export function loadPassword(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = path.join(homedir(), '.yotram', 'config.json'),
): string {
  if (env.YOTRAM_PASSWORD) return env.YOTRAM_PASSWORD;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { password?: unknown };
    if (typeof parsed.password === 'string' && parsed.password.length > 0) return parsed.password;
  } catch {
    // Fall through to the error below, whether the file is missing, unreadable, or malformed.
  }
  throw new Error(`No password configured. Set YOTRAM_PASSWORD or create ${configPath} with {"password": "..."}`);
}

export class Auth {
  private readonly secret: Buffer;

  constructor(private readonly password: string) {
    this.secret = createHmac('sha256', password).update('yotram-session-secret').digest();
  }

  checkPassword(candidate: unknown): boolean {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.password);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  createSessionToken(): string {
    const expires = String(Date.now() + SESSION_MAX_AGE_MS);
    const signature = createHmac('sha256', this.secret).update(expires).digest('hex');
    return `${expires}.${signature}`;
  }

  verifySessionToken(token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const [expires, signature] = token.split('.');
    if (!expires || !signature) return false;
    const expected = createHmac('sha256', this.secret).update(expires).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return false;
    const expiresAt = Number(expires);
    return Number.isFinite(expiresAt) && Date.now() < expiresAt;
  }
}

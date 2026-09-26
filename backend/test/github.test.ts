import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ghAvailable, reduceChecks } from '../src/github.js';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function folder() { const root = await mkdtemp(path.join(tmpdir(), 'yotram-github-')); cleanups.push(() => rm(root, { recursive: true, force: true })); return root; }

describe('reduceChecks', () => {
  it('returns none for an empty rollup', () => {
    expect(reduceChecks([])).toBe('none');
  });
  it('returns passing when every check succeeded', () => {
    expect(reduceChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }])).toBe('passing');
  });
  it('returns failing when any check failed, cancelled, or timed out', () => {
    expect(reduceChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failing');
    expect(reduceChecks([{ conclusion: 'CANCELLED' }])).toBe('failing');
    expect(reduceChecks([{ conclusion: 'TIMED_OUT' }])).toBe('failing');
  });
  it('returns pending when a check has no conclusion yet and none have failed', () => {
    expect(reduceChecks([{ conclusion: 'SUCCESS' }, { conclusion: null }])).toBe('pending');
  });
});

describe('ghAvailable', () => {
  it('returns true when an executable named gh is on PATH', async () => {
    const bin = await folder();
    const filePath = path.join(bin, 'gh');
    await writeFile(filePath, '#!/bin/sh\nexit 0\n');
    await chmod(filePath, 0o755);
    const original = process.env.PATH;
    process.env.PATH = bin;
    try { expect(await ghAvailable()).toBe(true); } finally { process.env.PATH = original; }
  });

  it('returns false when no executable named gh is on PATH', async () => {
    const bin = await folder();
    const original = process.env.PATH;
    process.env.PATH = bin;
    try { expect(await ghAvailable()).toBe(false); } finally { process.env.PATH = original; }
  });
});

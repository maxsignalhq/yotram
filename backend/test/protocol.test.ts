import { describe, it, expect } from 'vitest';
import { isClientMessage } from '../src/protocol.js';

describe('isClientMessage', () => {
  it('accepts a valid fs:read message', () => {
    expect(isClientMessage({ type: 'fs:read', path: 'a.txt' })).toBe(true);
  });

  it('rejects a message with unknown type', () => {
    expect(isClientMessage({ type: 'bogus' })).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isClientMessage('not an object')).toBe(false);
  });

  it('accepts valid git:* client messages', () => {
    expect(isClientMessage({ type: 'git:status' })).toBe(true);
    expect(isClientMessage({ type: 'git:diff', path: 'a.ts', staged: false })).toBe(true);
    expect(isClientMessage({ type: 'git:stage', path: 'a.ts' })).toBe(true);
    expect(isClientMessage({ type: 'git:unstage', path: 'a.ts' })).toBe(true);
    expect(isClientMessage({ type: 'git:commit', message: 'fix bug' })).toBe(true);
    expect(isClientMessage({ type: 'git:branches' })).toBe(true);
    expect(isClientMessage({ type: 'git:checkout', name: 'main' })).toBe(true);
  });

  it('rejects malformed git:* client messages', () => {
    expect(isClientMessage({ type: 'git:diff', path: 'a.ts' })).toBe(false);
    expect(isClientMessage({ type: 'git:diff', path: 'a.ts', staged: 'no' })).toBe(false);
    expect(isClientMessage({ type: 'git:commit' })).toBe(false);
    expect(isClientMessage({ type: 'git:checkout' })).toBe(false);
  });
});

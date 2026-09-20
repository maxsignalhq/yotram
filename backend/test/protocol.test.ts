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
});

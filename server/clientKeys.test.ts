import { describe, expect, it } from 'vitest';
import { sessionKey } from './clientKeys';

describe('sessionKey', () => {
  it('uses a valid session ID', () => {
    expect(sessionKey('3f2b8c1e-9d4a-4b7e-8a61-2c5d0e9f7a13', '1.2.3.4')).toBe(
      's:3f2b8c1e-9d4a-4b7e-8a61-2c5d0e9f7a13'
    );
  });

  it('uses the first value when the header is repeated', () => {
    expect(sessionKey(['abcdefgh1234', 'zzzzzzzz9999'], '1.2.3.4')).toBe('s:abcdefgh1234');
  });

  it('falls back to the IP when the header is missing', () => {
    expect(sessionKey(undefined, '1.2.3.4')).toBe('ip:1.2.3.4');
  });

  it('falls back to the IP for malformed or oversized IDs', () => {
    expect(sessionKey('short', '1.2.3.4')).toBe('ip:1.2.3.4');
    expect(sessionKey('has spaces in it', '1.2.3.4')).toBe('ip:1.2.3.4');
    expect(sessionKey('a'.repeat(65), '1.2.3.4')).toBe('ip:1.2.3.4');
  });
});

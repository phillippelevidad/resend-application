import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './is-loopback-host.ts';

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '::1', 'localhost'])(
    'accepts %s, so the auth-skipping local server may bind to it',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    '0.0.0.0',
    '::',
    '',
    '192.168.1.10',
    '10.0.0.1',
    '127.0.0.2',
    'LOCALHOST',
    'localhost.example.com',
    '[::1]',
  ])(
    'rejects %j, so the server refuses to expose unauthenticated routes beyond loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

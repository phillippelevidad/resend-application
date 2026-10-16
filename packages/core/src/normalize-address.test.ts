import { describe, expect, it } from 'vitest';
import { normalizeAddress } from './normalize-address.ts';

describe('normalizeAddress', () => {
  it('lowercases and trims, so one address yields one hash and one mask', () => {
    expect(normalizeAddress('  Delivered@Resend.DEV ')).toBe('delivered@resend.dev');
  });

  it('trims tabs and newlines around the address as well as spaces', () => {
    expect(normalizeAddress('\t\nBOUNCED@resend.dev\r\n')).toBe('bounced@resend.dev');
  });

  it('keeps inner characters, so a +label form stays distinct from its base address', () => {
    expect(normalizeAddress('Delivered+Label@resend.dev')).toBe('delivered+label@resend.dev');
  });

  it('does not parse a display name: the whole input is lowercased as is', () => {
    expect(normalizeAddress(' Billing Team <Delivered@resend.dev> ')).toBe(
      'billing team <delivered@resend.dev>',
    );
  });

  it('lowercases locale-independently, so a dotted capital I maps the same on every host', () => {
    expect(normalizeAddress('İ')).toBe('i̇');
  });
});

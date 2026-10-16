import { describe, expect, it } from 'vitest';
import { maskAddress } from './mask-address.ts';

describe('maskAddress', () => {
  it('masks the ratified example: local part keeps min(3, n/3), each domain label its first character', () => {
    expect(maskAddress('delivered@resend.dev')).toBe('del******@r*****.d**');
  });

  it('masks an input with no @ as one local part, dots included', () => {
    expect(maskAddress('resend.dev')).toBe('res*******');
  });

  it('treats the whole local part as one token, so its separators are masked too', () => {
    expect(maskAddress('delivered+label@resend.dev')).toBe('del************@r*****.d**');
  });

  it('splits at the last @, so an @ inside the local part stays masked there', () => {
    expect(maskAddress('a@b@resend.dev')).toBe('a**@r*****.d**');
  });

  it('masks digits in the kept characters of the local part', () => {
    expect(maskAddress('123456789@resend.dev')).toBe('*********@r*****.d**');
  });

  it('maps control characters to *, so no terminal escape reaches CLI output', () => {
    const masked = maskAddress('\u001b[2Jdelivered@resend.dev');
    expect(masked).toBe('*[***********@r*****.d**');
    expect(masked).not.toMatch(/\p{Cc}/u);
  });
});

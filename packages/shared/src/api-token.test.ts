// D3, api-tokens spec: the token format, the tag check that runs before any database read, and the
// hash a token is stored as.
import { describe, expect, it } from 'vitest';
import { hashApiToken, hasValidTag, mintApiToken, tokenTagKeyId } from './api-token.ts';

const tagKey = Buffer.from('a'.repeat(64), 'hex');
const otherKey = Buffer.from('b'.repeat(64), 'hex');
const tokenFormat = /^ldg_[0-9a-f]{64}_[0-9a-f]{64}$/;

describe('mintApiToken', () => {
  it('mints a token in the ldg_<random>_<tag> format whose tag verifies under its key', () => {
    const { token, tokenHash } = mintApiToken(tagKey);

    expect(token).toMatch(tokenFormat);
    expect(hasValidTag(token, tagKey)).toBe(true);
    expect(tokenHash).toBe(hashApiToken(token));
  });

  it('two mints under one key differ in their random part', () => {
    const first = mintApiToken(tagKey).token.split('_')[1];
    const second = mintApiToken(tagKey).token.split('_')[1];

    expect(first).not.toBe(second);
  });
});

describe('hasValidTag', () => {
  it('rejects a well-formed token whose tag was computed under another key', () => {
    const { token } = mintApiToken(otherKey);

    expect(token).toMatch(tokenFormat);
    expect(hasValidTag(token, tagKey)).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(hasValidTag('ldg_abc', tagKey)).toBe(false);
    expect(hasValidTag('', tagKey)).toBe(false);
    const { token } = mintApiToken(tagKey);
    expect(hasValidTag(token.toUpperCase(), tagKey)).toBe(false);
    expect(hasValidTag(`${token}\n`, tagKey)).toBe(false);
  });

  it('rejects a tag one character short or long', () => {
    const { token } = mintApiToken(tagKey);

    expect(hasValidTag(token.slice(0, -1), tagKey)).toBe(false);
    expect(hasValidTag(`${token}0`, tagKey)).toBe(false);
  });

  it('rejects a token whose last tag character was changed', () => {
    const { token } = mintApiToken(tagKey);
    const last = token.at(-1);
    const changed = `${token.slice(0, -1)}${last === '0' ? '1' : '0'}`;

    expect(hasValidTag(changed, tagKey)).toBe(false);
  });
});

describe('tokenTagKeyId', () => {
  it('is 8 lowercase hex, stable for one key and different for another', () => {
    const id = tokenTagKeyId(tagKey);

    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(tokenTagKeyId(Buffer.from('a'.repeat(64), 'hex'))).toBe(id);
    expect(tokenTagKeyId(otherKey)).not.toBe(id);
  });
});

describe('hashApiToken', () => {
  it('is 64 lowercase hex and stable for one token', () => {
    const { token } = mintApiToken(tagKey);

    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(token)).toBe(hashApiToken(token));
    expect(hashApiToken(token)).not.toBe(hashApiToken(mintApiToken(tagKey).token));
  });

  it('is the SHA-256 of the whole string (FIPS 180-2 vector)', () => {
    expect(hashApiToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

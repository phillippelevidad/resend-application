import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// D3: `ldg_<random>_<tag>`, both parts lowercase hex, because base64url's alphabet holds `_`.
const tokenShape = /^ldg_([0-9a-f]{64})_([0-9a-f]{64})$/;

// D3: the tag is HMAC-SHA-256 under the installation's tag key over `random` as the token spells it
// (its 64 hex characters), so the check recomputes it from the token's text alone.
const tagOf = (random: string, tagKey: Uint8Array): string =>
  createHmac('sha256', tagKey).update(random).digest('hex');

// D3: SHA-256 of the whole token string, the only form a token is stored in. Unkeyed is enough:
// `random` carries 256 bits.
export const hashApiToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// D3: the plaintext goes back once, to the caller that created it; only `tokenHash` is stored.
export const mintApiToken = (tagKey: Uint8Array): { token: string; tokenHash: string } => {
  const random = randomBytes(32).toString('hex');
  const token = `ldg_${random}_${tagOf(random, tagKey)}`;
  return { token, tokenHash: hashApiToken(token) };
};

// D3: shape, then the recomputed tag compared in constant time. No I/O, so a forged or malformed
// token is rejected before any database connection (api-tokens spec).
export const hasValidTag = (token: string, tagKey: Uint8Array): boolean => {
  const match = tokenShape.exec(token);
  if (match === null) return false;
  const [, random = '', tag = ''] = match;
  return timingSafeEqual(Buffer.from(tagOf(random, tagKey), 'hex'), Buffer.from(tag, 'hex'));
};

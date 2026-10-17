import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addressHashKeyId, hashAddress } from './hash-address.ts';
import { maskInputChar } from './testing/mask-input-char.ts';

const key = fc.uint8Array({ minLength: 32, maxLength: 32 });

// Lowercase ASCII only, so a case variant lowercases back to it: `ß` upper-cases to `SS`, which
// normalizes to a different address.
const lowerChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789.+-_');
const lowerPart = fc.string({ unit: lowerChar, minLength: 1, maxLength: 20 });

// A normalized address under Resend's test domain, `+label` forms included.
const normalizedAddress = fc
  .tuple(lowerPart, fc.array(lowerPart, { maxLength: 2 }))
  .map(([local, labels]) => `${local}@${[...labels, 'resend', 'dev'].join('.')}`);

// The same address with each character's case chosen independently and whitespace padding, so
// it normalizes to the address it came from.
const variantOf = (address: string) =>
  fc
    .tuple(
      fc.array(fc.boolean(), { minLength: address.length, maxLength: address.length }),
      fc.constantFrom('', ' ', '  ', '\t', '\n', ' \r\n'),
      fc.constantFrom('', ' ', '  ', '\t', '\n', ' \r\n'),
    )
    .map(
      ([upper, before, after]) =>
        before +
        Array.from(address, (char, index) => (upper[index] ? char.toUpperCase() : char)).join('') +
        after,
    );

// Free strings, so the format holds for any input, not only address-shaped ones.
const anyInput = fc.oneof(
  normalizedAddress,
  fc.string({ unit: maskInputChar, maxLength: 40, size: 'max' }),
);

const hashFormat = /^[0-9a-f]{8}\.[0-9a-f]{64}$/;

describe('hashAddress', () => {
  it('matches <key_id>.<64 hex>, so a stored hash is recognizable and names its key', () => {
    fc.assert(
      fc.property(key, anyInput, (k, input) => {
        expect(hashAddress(k, input)).toMatch(hashFormat);
      }),
    );
  });

  it('is deterministic under one key, so a lookup finds the rows written earlier', () => {
    fc.assert(
      fc.property(key, anyInput, (k, input) => {
        expect(hashAddress(k, input)).toBe(hashAddress(k, input));
      }),
    );
  });

  it('hashes addresses that normalize equal to one value, so case and padding never split a recipient', () => {
    fc.assert(
      fc.property(
        key,
        normalizedAddress.chain((address) => fc.tuple(fc.constant(address), variantOf(address))),
        (k, [address, variant]) => {
          expect(hashAddress(k, variant)).toBe(hashAddress(k, address));
        },
      ),
    );
  });

  it('hashes `  Delivered@Resend.DEV ` and `delivered@resend.dev` equal under one key', () => {
    const k = new Uint8Array(32).fill(7);
    expect(hashAddress(k, '  Delivered@Resend.DEV ')).toBe(hashAddress(k, 'delivered@resend.dev'));
  });

  it('gives different key_id prefixes and hashes under two keys, so a rotated key never matches old rows', () => {
    fc.assert(
      fc.property(
        fc.tuple(key, key).filter(([a, b]) => a.some((byte, index) => byte !== b[index])),
        normalizedAddress,
        ([a, b], address) => {
          expect(addressHashKeyId(a)).not.toBe(addressHashKeyId(b));
          expect(hashAddress(a, address).slice(0, 8)).toBe(addressHashKeyId(a));
          expect(hashAddress(a, address)).not.toBe(hashAddress(b, address));
        },
      ),
    );
  });
});

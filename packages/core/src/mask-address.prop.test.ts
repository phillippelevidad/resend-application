import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { maskAddress } from './mask-address.ts';
import { maskInputChar } from './testing/mask-input-char.ts';

// `size: 'max'`: fast-check's default size caps a string at 10 code points, and the `min(3, …)` cap
// only binds on a local part of 12 or more.
const part = fc.string({ unit: maskInputChar, maxLength: 20, size: 'max' });

// Address-shaped inputs put arbitrary local parts and labels under `resend.dev`; free strings cover
// no `@`, several `@` and any domain. Every part can hold digits, control characters, astral code
// points, `*` and separators.
const address = fc.oneof(
  fc
    .tuple(part, fc.array(part, { maxLength: 3 }))
    .map(([local, labels]) => `${local}@${[...labels, 'resend', 'dev'].join('.')}`),
  fc.string({ unit: maskInputChar, maxLength: 40, size: 'max' }),
);

// The tokens of an address are its local part (everything before the last `@`, or the whole
// input with no `@`) and each `.`-separated label after it. A character of a token is revealed
// when the output holds anything but `*` at its position. Returns the revealed count of each token.
function revealedPerToken(input: string, output: string): number[] {
  const inputChars = Array.from(input);
  const outputChars = Array.from(output);
  const at = inputChars.lastIndexOf('@');
  const spans: Array<[number, number]> = [];
  if (at === -1) {
    spans.push([0, inputChars.length]);
  } else {
    spans.push([0, at]);
    let start = at + 1;
    for (let index = start; index <= inputChars.length; index++) {
      if (index === inputChars.length || inputChars[index] === '.') {
        spans.push([start, index]);
        start = index + 1;
      }
    }
  }
  return spans.map(
    ([start, end]) => outputChars.slice(start, end).filter((char) => char !== '*').length,
  );
}

describe('maskAddress', () => {
  it('is idempotent, so redaction can replace a raw address with its mask', () => {
    fc.assert(
      fc.property(address, (input) => {
        const once = maskAddress(input);
        expect(maskAddress(once)).toBe(once);
      }),
    );
  });

  it('preserves length in code points', () => {
    fc.assert(
      fc.property(address, (input) => {
        expect(Array.from(maskAddress(input))).toHaveLength(Array.from(input).length);
      }),
    );
  });

  it('reveals no decimal digit', () => {
    fc.assert(
      fc.property(address, (input) => {
        expect(maskAddress(input)).not.toMatch(/\p{Nd}/u);
      }),
    );
  });

  it('reveals at most 3 characters per token', () => {
    fc.assert(
      fc.property(address, (input) => {
        for (const revealed of revealedPerToken(input, maskAddress(input))) {
          expect(revealed).toBeLessThanOrEqual(3);
        }
      }),
    );
  });

  it('holds no control character, so no terminal escape reaches CLI output', () => {
    fc.assert(
      fc.property(address, (input) => {
        expect(maskAddress(input)).not.toMatch(/\p{Cc}/u);
      }),
    );
  });
});

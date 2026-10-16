import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { maskText } from './mask-text.ts';
import { maskInputChar } from './testing/mask-input-char.ts';

const text = fc.string({ unit: maskInputChar, maxLength: 40 });

// A token of the input is a maximal run of token characters: a control character (D13 step 1 maps
// it to `*` before tokenizing), `*`, or anything outside whitespace, punctuation and symbols.
function isTokenChar(char: string): boolean {
  return char === '*' || /\p{Cc}/u.test(char) || !/[\p{White_Space}\p{P}\p{S}]/u.test(char);
}

// A character of a token is revealed when the output holds anything but `*` at its position.
// Returns the revealed count of each input token.
function revealedPerToken(input: string, output: string): number[] {
  const inputChars = Array.from(input);
  const outputChars = Array.from(output);
  const counts: number[] = [];
  let current: number | undefined;
  inputChars.forEach((char, index) => {
    if (!isTokenChar(char)) {
      current = undefined;
      return;
    }
    if (current === undefined) {
      current = counts.push(0) - 1;
    }
    if (outputChars[index] !== '*') {
      counts[current] = (counts[current] ?? 0) + 1;
    }
  });
  return counts;
}

describe('maskText', () => {
  it('is idempotent, so redaction can replace a raw subject with its mask', () => {
    fc.assert(
      fc.property(text, (input) => {
        const once = maskText(input);
        expect(maskText(once)).toBe(once);
      }),
    );
  });

  it('preserves length in code points', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(Array.from(maskText(input))).toHaveLength(Array.from(input).length);
      }),
    );
  });

  it('reveals no decimal digit, so no one-time code or order number leaks', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(maskText(input)).not.toMatch(/\p{Nd}/u);
      }),
    );
  });

  it('reveals at most 3 characters per token', () => {
    fc.assert(
      fc.property(text, (input) => {
        for (const revealed of revealedPerToken(input, maskText(input))) {
          expect(revealed).toBeLessThanOrEqual(3);
        }
      }),
    );
  });

  it('holds no control character, so no terminal escape reaches CLI output', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(maskText(input)).not.toMatch(/\p{Cc}/u);
      }),
    );
  });
});

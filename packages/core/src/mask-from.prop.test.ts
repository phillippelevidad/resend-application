import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { maskFrom } from './mask-from.ts';
import { maskInputChar } from './testing/mask-input-char.ts';

// `size: 'max'`: fast-check's default size caps a string at 10 code points, and the `min(3, …)` cap
// only binds on a token of 12 or more.
const part = fc.string({ unit: maskInputChar, maxLength: 20, size: 'max' });
const address = fc
  .tuple(part, fc.array(part, { maxLength: 3 }))
  .map(([local, labels]) => `${local}@${[...labels, 'resend', 'dev'].join('.')}`);

// Senders with a display name (with and without the space before `<`), bare addresses, and free
// strings, whose code points include `<` and `>` as well as digits, control characters, astral
// code points, `*` and separators.
const sender = fc.oneof(
  fc.tuple(part, address).map(([name, addr]) => `${name} <${addr}>`),
  fc.tuple(part, address).map(([name, addr]) => `${name}<${addr}>`),
  address,
  fc.string({ unit: maskInputChar, maxLength: 40, size: 'max' }),
);

type Span = [number, number];

// Text tokens: maximal runs of control characters, `*`, or anything outside whitespace,
// punctuation and symbols (D13 steps 1 and 2).
function textSpans(chars: string[], offset: number): Span[] {
  const spans: Span[] = [];
  let start: number | undefined;
  chars.forEach((char, index) => {
    const tokenChar =
      char === '*' || /\p{Cc}/u.test(char) || !/[\p{White_Space}\p{P}\p{S}]/u.test(char);
    if (tokenChar && start === undefined) {
      start = index;
    } else if (!tokenChar && start !== undefined) {
      spans.push([offset + start, offset + index]);
      start = undefined;
    }
  });
  if (start !== undefined) {
    spans.push([offset + start, offset + chars.length]);
  }
  return spans;
}

// Address tokens: the local part before the last `@` (the whole input with no `@`), then each
// `.`-separated label after it.
function addressSpans(chars: string[], offset: number): Span[] {
  const at = chars.lastIndexOf('@');
  if (at === -1) {
    return [[offset, offset + chars.length]];
  }
  const spans: Span[] = [[offset, offset + at]];
  let start = at + 1;
  for (let index = start; index <= chars.length; index++) {
    if (index === chars.length || chars[index] === '.') {
      spans.push([offset + start, offset + index]);
      start = index + 1;
    }
  }
  return spans;
}

// A sender ending in `>` and holding a `<` has the text tokens of the name before its last `<`
// and the address tokens between that `<` and the final `>`; any other sender has address tokens.
// A character of a token is revealed when the output holds anything but `*` at its position.
// Returns the revealed count of each token.
function revealedPerToken(input: string, output: string): number[] {
  const inputChars = Array.from(input);
  const outputChars = Array.from(output);
  const lt = inputChars.lastIndexOf('<');
  const spans =
    lt !== -1 && inputChars.at(-1) === '>'
      ? [
          ...textSpans(inputChars.slice(0, lt), 0),
          ...addressSpans(inputChars.slice(lt + 1, -1), lt + 1),
        ]
      : addressSpans(inputChars, 0);
  return spans.map(
    ([start, end]) => outputChars.slice(start, end).filter((char) => char !== '*').length,
  );
}

describe('maskFrom', () => {
  it('is idempotent, so redaction can replace a raw sender with its mask', () => {
    fc.assert(
      fc.property(sender, (input) => {
        const once = maskFrom(input);
        expect(maskFrom(once)).toBe(once);
      }),
    );
  });

  it('preserves length in code points', () => {
    fc.assert(
      fc.property(sender, (input) => {
        expect(Array.from(maskFrom(input))).toHaveLength(Array.from(input).length);
      }),
    );
  });

  it('reveals no decimal digit', () => {
    fc.assert(
      fc.property(sender, (input) => {
        expect(maskFrom(input)).not.toMatch(/\p{Nd}/u);
      }),
    );
  });

  it('reveals at most 3 characters per token', () => {
    fc.assert(
      fc.property(sender, (input) => {
        for (const revealed of revealedPerToken(input, maskFrom(input))) {
          expect(revealed).toBeLessThanOrEqual(3);
        }
      }),
    );
  });

  it('holds no control character, so no terminal escape reaches CLI output', () => {
    fc.assert(
      fc.property(sender, (input) => {
        expect(maskFrom(input)).not.toMatch(/\p{Cc}/u);
      }),
    );
  });
});

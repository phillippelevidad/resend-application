import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sanitizeForJsonb } from './sanitize-for-jsonb.ts';

// One UTF-16 unit or pair of a generated string. NUL and lone surrogates are weighted in, or small
// samples would rarely hold one; two adjacent lone units can still form a valid pair.
const jsonChar = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('a', 'Z', 'é', ' ', '�') },
  { weight: 2, arbitrary: fc.constant('\u0000') },
  { weight: 2, arbitrary: fc.constantFrom('\uD800', '\uDBFF', '\uDC00', '\uDFFF') },
  { weight: 1, arbitrary: fc.constant('\u{1F600}') },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }) },
);

const jsonValue = fc.jsonValue({ stringUnit: jsonChar, maxDepth: 3 });

// Every string the value holds, object keys included.
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...stringsIn(child)]);
  }
  return [];
}

const storable = (text: string): boolean => text.isWellFormed() && !text.includes('\u0000');

describe('sanitizeForJsonb', () => {
  it('leaves no NUL or lone surrogate in any value or key, so jsonb accepts the payload', () => {
    fc.assert(
      fc.property(jsonValue, (input) => {
        for (const text of stringsIn(sanitizeForJsonb(input).value)) {
          expect(storable(text)).toBe(true);
        }
      }),
    );
  });

  it('reports sanitized exactly when the output differs, so the metric counts only real repairs', () => {
    fc.assert(
      fc.property(jsonValue, (input) => {
        const { value, sanitized } = sanitizeForJsonb(input);
        expect(sanitized).toBe(JSON.stringify(value) !== JSON.stringify(input));
        expect(sanitized).toBe(!stringsIn(input).every(storable));
      }),
    );
  });

  it('is idempotent, so a sanitized payload passes through unchanged', () => {
    fc.assert(
      fc.property(jsonValue, (input) => {
        const once = sanitizeForJsonb(input).value;
        const twice = sanitizeForJsonb(once);
        expect(twice.sanitized).toBe(false);
        expect(twice.value).toEqual(once);
      }),
    );
  });

  it.each([
    ['NUL', '\u0000'],
    ['a lone high surrogate', '\uD800'],
    ['a lone low surrogate', '\uDC00'],
  ])('replaces %s in a value with U+FFFD and reports it', (_name, bad) => {
    expect(sanitizeForJsonb({ data: { subject: `a${bad}b` } })).toEqual({
      value: { data: { subject: 'a�b' } },
      sanitized: true,
    });
  });

  it.each([
    ['NUL', '\u0000'],
    ['a lone high surrogate', '\uD800'],
    ['a lone low surrogate', '\uDC00'],
  ])('replaces %s in an object key with U+FFFD and reports it', (_name, bad) => {
    expect(sanitizeForJsonb({ tags: { [`k${bad}`]: 'v' } })).toEqual({
      value: { tags: { 'k�': 'v' } },
      sanitized: true,
    });
  });

  it('leaves a valid surrogate pair intact and reports nothing', () => {
    const input = { data: { subject: 'hi \u{1F600}', tags: ['😀'] } };
    expect(sanitizeForJsonb(input)).toEqual({ value: input, sanitized: false });
  });

  it('accepts every JSON value kind, top-level strings and arrays included', () => {
    expect(sanitizeForJsonb(null)).toEqual({ value: null, sanitized: false });
    expect(sanitizeForJsonb(42)).toEqual({ value: 42, sanitized: false });
    expect(sanitizeForJsonb(true)).toEqual({ value: true, sanitized: false });
    expect(sanitizeForJsonb('\u0000')).toEqual({ value: '�', sanitized: true });
    expect(sanitizeForJsonb(['ok', '\uDFFF'])).toEqual({ value: ['ok', '�'], sanitized: true });
  });

  it('keeps a __proto__ key as an own key, as JSON.parse made it', () => {
    const input: unknown = JSON.parse('{"__proto__":{"a":"\\u0000"}}');
    const { value } = sanitizeForJsonb(input);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(JSON.stringify(value)).toBe('{"__proto__":{"a":"�"}}');
  });
});

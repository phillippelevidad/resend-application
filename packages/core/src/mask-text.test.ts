import { describe, expect, it } from 'vitest';
import { maskText } from './mask-text.ts';

describe('maskText', () => {
  it('masks the ratified subject example word by word, keeping spaces', () => {
    expect(maskText('Your invoice is ready')).toBe('Y*** in***** ** r****');
  });

  it('keeps at most 3 characters of a long token, where ⌊n/3⌋ alone would keep more', () => {
    expect(maskText('Internationalization')).toBe('Int*****************');
  });

  it('masks every digit of a one-time code, so no code is revealed', () => {
    const masked = maskText('Code 123456');
    expect(masked).toBe('C*** ******');
    expect(masked).not.toMatch(/\p{Nd}/u);
  });

  it('masks a digit even where a kept prefix holds it', () => {
    expect(maskText('Order 12345678 shipped')).toBe('O**** ******** sh*****');
  });

  it('maps an ESC in a display name to *, so no terminal escape reaches CLI output', () => {
    const masked = maskText('\u001b[31mBilling Team');
    expect(masked).toBe('*[**m******* T***');
    expect(masked).not.toMatch(/\p{Cc}/u);
  });

  it('keeps punctuation and symbols as separators, and * as a token character', () => {
    expect(maskText('Re: your order (#4521) — 50% off! ***')).toBe(
      '**: y*** o**** (#****) — **% o**! ***',
    );
  });

  it('counts astral characters as one code point each', () => {
    const masked = maskText('\u{1D400}\u{1D401}\u{1D402}\u{1D403}\u{1D404}\u{1D405}');
    expect(masked).toBe('\u{1D400}\u{1D401}****');
    expect(Array.from(masked)).toHaveLength(6);
  });

  it('returns an empty subject unchanged', () => {
    expect(maskText('')).toBe('');
  });
});

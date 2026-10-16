import fc from 'fast-check';

// One code point of a mask property's input (data-modeling → PII & retention). The mask properties
// are vacuous unless small samples hold every class D13 treats specially, so each class is weighted
// in explicitly; the `binary` branch adds any other code point. Token characters dominate, so
// tokens run long enough to exercise min(3, ⌊n/3⌋).
export const maskInputChar = fc.oneof(
  // Token characters: ASCII and Latin-1 letters, a combining mark, astral letters.
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      'a',
      'b',
      'e',
      'r',
      'x',
      'D',
      'Q',
      'é',
      'ß',
      '́',
      '\u{1D400}',
      '\u{20000}',
    ),
  },
  // `\p{Nd}`: ASCII, Arabic-Indic and an astral mathematical digit.
  { weight: 2, arbitrary: fc.constantFrom('0', '4', '9', '٣', '\u{1D7D8}') },
  // `\p{Cc}`: C0 (tab, LF, CR and NEL are whitespace too), ESC, DEL, C1 (CSI).
  {
    weight: 2,
    arbitrary: fc.constantFrom('\u0000', '\t', '\n', '\r', '\u001b', '\u007f', '\u0085', '\u009b'),
  },
  { weight: 2, arbitrary: fc.constant('*') },
  // Separators: whitespace, punctuation and symbols, the address and sender delimiters included,
  // and an astral symbol.
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      ' ',
      ' ',
      '　',
      '.',
      '@',
      '<',
      '>',
      '-',
      '_',
      '+',
      '"',
      '$',
      '—',
      '\u{1F600}',
    ),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }) },
);

// D13 (data-modeling → PII & retention): masks a subject or a display name. All counts are in
// code points, so the mask preserves length in code points.

// Step 1: C0, DEL and C1 become `*` before tokenizing, so no control character acts as a
// separator that a second pass would read differently, and no terminal escape reaches the output.
const controlCharacter = /\p{Cc}/gu;

// Step 2: a token is a maximal run of anything but whitespace, punctuation and symbols. `*` is
// itself punctuation but counts as a token character, or a second pass would split `del******`
// and idempotence would fail (D13).
const token = /(?:\*|[^\p{White_Space}\p{P}\p{S}])+/gu;

// Step 4: no decimal digit survives, kept characters included (one-time codes, order numbers).
const decimalDigit = /\p{Nd}/gu;

// Step 3: a token of n code points keeps its first min(3, ⌊n/3⌋).
function maskToken(value: string): string {
  const chars = Array.from(value);
  const kept = Math.min(3, Math.floor(chars.length / 3));
  return chars.slice(0, kept).join('') + '*'.repeat(chars.length - kept);
}

export function maskText(text: string): string {
  return text.replace(controlCharacter, '*').replace(token, maskToken).replace(decimalDigit, '*');
}

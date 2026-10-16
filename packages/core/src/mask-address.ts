// D13 (data-modeling → PII & retention): masks an address. All counts are in code points, so the
// mask preserves length in code points.

// Step 1: C0, DEL and C1 become `*` first, so no terminal escape reaches the output.
const controlCharacter = /\p{Cc}/gu;

// Step 4: no decimal digit survives, kept characters included.
const decimalDigit = /\p{Nd}/gu;

// The whole local part is one token: it keeps its first min(3, ⌊n/3⌋) code points, separators
// included in the count.
function maskLocalPart(localPart: string): string {
  const chars = Array.from(localPart);
  const kept = Math.min(3, Math.floor(chars.length / 3));
  return chars.slice(0, kept).join('') + '*'.repeat(chars.length - kept);
}

function maskLabel(label: string): string {
  const chars = Array.from(label);
  return chars.slice(0, 1).join('') + '*'.repeat(Math.max(0, chars.length - 1));
}

export function maskAddress(address: string): string {
  const mapped = address.replace(controlCharacter, '*');
  // The last `@`, so a quoted local part holding `@` stays in the local part. With none, the
  // whole string is a local part.
  const at = mapped.lastIndexOf('@');
  const masked =
    at === -1
      ? maskLocalPart(mapped)
      : `${maskLocalPart(mapped.slice(0, at))}@${mapped
          .slice(at + 1)
          .split('.')
          .map(maskLabel)
          .join('.')}`;
  return masked.replace(decimalDigit, '*');
}

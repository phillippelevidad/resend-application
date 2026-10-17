// The one address normalization (data-modeling → Modeling conventions, D14). It runs before an
// address is hashed or masked. `toLowerCase` is locale-independent, unlike `toLocaleLowerCase`.
// It MUST NOT parse a display name: a caller passes a bare address.
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

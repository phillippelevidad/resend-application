// D3: Postgres `jsonb` rejects `\u0000` and lone UTF-16 surrogates, in object keys as well as in
// values, so a verified payload holding one would fail its insert on every retry. Each becomes
// U+FFFD; a valid surrogate pair is left intact.

export type SanitizeForJsonbResult = { readonly value: unknown; readonly sanitized: boolean };

const replacement = '�';

// Any JSON value: object, array, string, number, boolean or `null`.
export function sanitizeForJsonb(value: unknown): SanitizeForJsonbResult {
  let sanitized = false;

  const sanitizeString = (text: string): string => {
    // `toWellFormed` replaces each lone surrogate with U+FFFD and keeps valid pairs.
    const clean = text.toWellFormed().replaceAll('\u0000', replacement);
    if (clean !== text) sanitized = true;
    return clean;
  };

  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return sanitizeString(node);
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node === 'object' && node !== null) {
      // `fromEntries` defines own properties, so a `__proto__` key stays a key, as `JSON.parse`
      // made it, instead of setting the prototype. Two keys that sanitize equal keep the last value,
      // as `JSON.parse` does for a repeated key.
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [sanitizeString(key), visit(child)]),
      );
    }
    return node;
  };

  const result = visit(value);
  return { value: result, sanitized };
}

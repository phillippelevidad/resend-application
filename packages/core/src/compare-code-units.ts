// ADR-003, ADR-004: every ordering the ledger depends on (the fold's `svix_id` tie-break, the
// recipient lock order by `address_hash`) compares by UTF-16 code unit, never by a locale.
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

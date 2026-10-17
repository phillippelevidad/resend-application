import { sql } from 'drizzle-orm';
import { type AnyPgColumn, type CheckBuilder, check } from 'drizzle-orm/pg-core';

// D18: a closed set is `text` plus a named CHECK listing the core Zod enum's members, never a
// `pgEnum`. DDL takes no bind parameters (drizzle-kit would render one as `$1`), so the list is
// inlined: drizzle expands the array to `(…, …)` and `inlineParams()` quotes each member through
// the dialect's string escaping.
export function closedSetCheck(
  name: string,
  column: AnyPgColumn,
  members: readonly string[],
): CheckBuilder {
  return check(name, sql`${column} in ${members}`.inlineParams());
}

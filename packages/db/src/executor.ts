import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core';

// No relational-query schema is registered on the client: repositories use the query builder only.
type NoSchema = Record<string, never>;

// What every repository function takes first: the database or a transaction. In drizzle-orm 0.45.4
// `PgTransaction` extends `PgDatabase`, and `NodePgDatabase` extends the same `PgDatabase`, so this
// one type admits both, and the same function runs inside or outside a transaction.
export type Executor = PgDatabase<NodePgQueryResultHKT, NoSchema>;

// The transaction alone, what `db.transaction(cb)` hands `cb`. A function that locks takes it: outside
// a transaction its lock would release at the statement's autocommit (ADR-004).
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  NoSchema,
  ExtractTablesWithRelations<NoSchema>
>;

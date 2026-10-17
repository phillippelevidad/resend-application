// drizzle-kit is a dev-only generator: migrations run through drizzle-orm's programmatic `migrate()`
// (`src/prepare-database.ts`, ADR-018), so no runtime loads this file. No `dbCredentials`:
// `generate` diffs the schema against the snapshots in `drizzle/meta`, never a live database.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './drizzle',
});

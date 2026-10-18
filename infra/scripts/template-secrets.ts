import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// CBL-01's pattern (D33 step 5): a webhook signing secret, a Resend API key, a Postgres URL or a
// Ledger API token.
const SECRET_PATTERN = /whsec_|re_[A-Za-z0-9]{8}|postgres(ql)?:\/\/|ldg_[0-9a-f]{20}/;

// D33 step 5: whether any synthesized file in the cloud assembly matches CBL-01's pattern. The
// `asset.*` folders are skipped: they hold the esbuild bundles, built from tracked source and the
// lockfile only, never from a deploy input, and bundled libraries match the pattern by themselves
// (`pg`'s `new URL(str, "postgres://base")`, esbuild's `require_<module>` helpers, and in the
// ingest bundle `standardwebhooks`' `"whsec_"` prefix and ingest's own `whsec_` pattern; measured
// 2026-10-17). A deploy input can reach only the templates, manifests and metadata, which are all
// scanned. Answers a boolean, never the match, which would be the secret.
export function findTemplateSecret(cdkOutDir: string): boolean {
  for (const entry of readdirSync(cdkOutDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('asset.')) continue;
    const path = join(cdkOutDir, entry.name);
    if (entry.isDirectory()) {
      if (findTemplateSecret(path)) return true;
    } else if (entry.isFile() && SECRET_PATTERN.test(readFileSync(path, 'utf8'))) {
      return true;
    }
  }
  return false;
}

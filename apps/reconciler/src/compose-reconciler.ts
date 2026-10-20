import type { Reconciler } from '@ledger/reconciler';
import { type ResendConfiguration, resendConfiguration } from './reconciler.config.ts';

export type ComposeReconcilerDeps<Db> = {
  // Reads `ledger/database` and builds the size-1 pool from it (ADR-005).
  openDatabase: () => Promise<Db>;
  // Reads `ledger/resend-api-key` as it stands now.
  readResendApiKey: () => Promise<string>;
  webhookId: string | undefined;
  // Builds the reconciler over the pool and the Resend side, or none (D21).
  build: (db: Db, resend: ResendConfiguration | undefined) => Reconciler;
};

// Slice 4 D20, D21: what `main.ts` composes, apart from it so a test drives it with no AWS client.
// Nothing is read at import, so the bundle loads with no AWS access. The pool is opened on the first
// invocation through one memoized promise, invalidated on a failure only, and reused by every warm
// invocation. The Resend key is read on every invocation, because `pnpm aws:deploy` writes it after
// `cdk deploy` and again on a rotation: a key cached per container would hold the CDK placeholder
// or the revoked key for the container's lifetime. The reconciler and its Resend client are rebuilt
// only when the key read differs from the one they were built with, the cache's invalidation
// trigger; runs are hourly plus manual, so the read is one `GetSecretValue` per run.
export function composeReconciler<Db>({
  openDatabase,
  readResendApiKey,
  webhookId,
  build,
}: ComposeReconcilerDeps<Db>): Reconciler {
  let database: Promise<Db> | undefined;
  const databaseOnce = (): Promise<Db> => {
    database ??= openDatabase().catch((error: unknown) => {
      database = undefined;
      throw error;
    });
    return database;
  };

  let composed: { apiKey: string | undefined; reconciler: Reconciler } | undefined;
  const current = async (): Promise<Reconciler> => {
    const db = await databaseOnce();
    // The key never reaches a log, an error or an output (integrations.md rule 7).
    const resend = resendConfiguration(webhookId, await readResendApiKey());
    if (composed === undefined || composed.apiKey !== resend?.apiKey) {
      composed = { apiKey: resend?.apiKey, reconciler: build(db, resend) };
    }
    return composed.reconciler;
  };

  return {
    runScheduled: async () => (await current()).runScheduled(),
    runClaimed: async (runId) => (await current()).runClaimed(runId),
  };
}

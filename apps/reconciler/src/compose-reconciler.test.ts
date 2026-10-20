// Slice 4 D20, D21: what the reconciler's composition root reads per invocation and per container,
// over recording deps, with no AWS client and no environment. Regression: the Resend key was read
// once per container, so a key `pnpm aws:deploy` wrote after `cdk deploy` (or on a rotation) never
// reached a warm container, and every run there ended `reconciler_not_configured` or
// `resend_auth_failed`.
import type { Reconciler } from '@ledger/reconciler';
import { describe, expect, it } from 'vitest';
import { composeReconciler } from './compose-reconciler.ts';
import type { ResendConfiguration } from './reconciler.config.ts';

const PLACEHOLDER = 'ZmFrZS1wbGFjZWhvbGRlcg';

function setup(keys: string[], { failFirstOpen = false } = {}) {
  let opens = 0;
  let reads = 0;
  let builds = 0;
  // Which Resend side each run executed with: its key, or none.
  const runs: string[] = [];
  const reconciler = composeReconciler({
    openDatabase: async () => {
      opens += 1;
      if (failFirstOpen && opens === 1) throw new Error('secret read failed');
      return { pool: opens };
    },
    readResendApiKey: async () => {
      const key = keys[Math.min(reads, keys.length - 1)] ?? '';
      reads += 1;
      return key;
    },
    webhookId: 'wh_fake',
    build: (_db, resend: ResendConfiguration | undefined): Reconciler => {
      builds += 1;
      const label = resend === undefined ? 'not configured' : resend.apiKey;
      return {
        runScheduled: async () => {
          runs.push(label);
          return undefined;
        },
        runClaimed: async () => {
          runs.push(label);
          return undefined;
        },
      };
    },
  });
  return { reconciler, runs, counts: () => ({ opens, reads, builds }) };
}

describe('composeReconciler', () => {
  it('runs a warm invocation with a key written after the first one read the placeholder', async () => {
    const { reconciler, runs } = setup([PLACEHOLDER, 're_fake_written']);

    await reconciler.runScheduled();
    await reconciler.runClaimed(7);

    expect(runs).toEqual(['not configured', 're_fake_written']);
  });

  it('runs a warm invocation with a rotated key, never the revoked one', async () => {
    const { reconciler, runs } = setup(['re_fake_old', 're_fake_rotated']);

    await reconciler.runScheduled();
    await reconciler.runScheduled();

    expect(runs).toEqual(['re_fake_old', 're_fake_rotated']);
  });

  it('reads the key on every invocation, opens the pool once and keeps an unchanged composition', async () => {
    const { reconciler, runs, counts } = setup(['re_fake_key']);

    await reconciler.runScheduled();
    await reconciler.runClaimed(7);
    await reconciler.runScheduled();

    expect(runs).toEqual(['re_fake_key', 're_fake_key', 're_fake_key']);
    expect(counts()).toEqual({ opens: 1, reads: 3, builds: 1 });
  });

  it('opens the pool again on the next invocation after a failed open', async () => {
    const { reconciler, runs, counts } = setup(['re_fake_key'], { failFirstOpen: true });

    await expect(reconciler.runScheduled()).rejects.toThrow('secret read failed');
    await reconciler.runScheduled();

    expect(runs).toEqual(['re_fake_key']);
    expect(counts().opens).toBe(2);
  });
});

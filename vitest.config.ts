import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{packages,apps,sim,infra}/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.int.test.ts', '**/*.e2e.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{packages,apps,sim}/**/*.int.test.ts'],
          // One Testcontainers Postgres per run, migrated, then cloned per file (D40).
          globalSetup: ['packages/db/src/testing/postgres-global-setup.ts'],
          // From the first measured run (2026-10-17, image cached): global setup 2.3 s (container
          // plus migrations), a per-file clone 22–59 ms and its drop 17–91 ms, the slowest test
          // 24 ms; the whole cold run 25.6 s, warm 4.9 s. Both limits sit two orders of magnitude
          // above the measured work, so a test that hits one is stuck on a lock, not slow.
          testTimeout: 5_000,
          hookTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['{apps,sim}/**/*.e2e.test.ts'],
        },
      },
    ],
  },
});

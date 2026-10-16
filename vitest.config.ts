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
          // globalSetup (the Testcontainers Postgres harness) lands in slice 1.
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

// Ships 8's contract evidence (D23, ADR-019): the shared SDK ↔ API suite, with the real `createApi`
// served by `@hono/node-server` on a loopback port, as `main.ts` serves it. `apps/api` runs the same
// suite through the Lambda adapter.
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApi } from '@ledger/api';
import { readApiContract } from '@ledger/api/testing';

readApiContract('@hono/node-server', async (deps) => {
  const api = createApi(deps);
  let server: ReturnType<typeof serve> | undefined;
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: api.fetch, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) =>
      resolve(info.port),
    );
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server?.close(() => resolve())),
  };
});

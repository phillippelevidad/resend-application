import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import type { ClockPort } from '@ledger/shared';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { durationSchema } from './duration.schema.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import { reconcileRunResponseMapper } from './reconcile-run-response.mapper.ts';
import { reconcileRunResponseSchema } from './reconcile-run-response.schema.ts';
import type { StartReconcileCommand } from './start-reconcile.command.ts';

// `reconcile.start` → `POST /reconcile` (api-contract.md → reconcile.start).
export const startReconcileRoute = createRoute({
  method: 'post',
  path: '/reconcile',
  operationId: 'reconcile.start',
  summary: 'Start one manual reconcile run; poll reconcile.getRun until it finishes',
  middleware: requireScope('operate'),
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              dry_run: z.boolean().optional().openapi({ example: false }),
              lookback: durationSchema.optional().openapi({ example: '72h' }),
            })
            .openapi('ReconcileStart'),
        },
      },
      // Required, so a request with no body is refused rather than passed through; `{}` is valid.
      required: true,
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: reconcileRunResponseSchema } },
      description: 'The inserted run, `finished_at: null`; the reconciler runs it asynchronously.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      403: errorDescriptions[403],
      409: '`reconcile_in_progress`: another run is unfinished inside its time budget.',
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One command, one mapper (pp-backend → One route per operation). `202`: the run starts after the
// answer (api-contract.md → Conventions → Long-running commands).
export function startReconcileHandler(
  command: StartReconcileCommand,
  clock: ClockPort,
): RouteHandler<typeof startReconcileRoute, ApiEnv> {
  return async (c) => {
    const { dry_run, lookback } = c.req.valid('json');
    const run = await command.execute({ dryRun: dry_run ?? false, lookbackMs: lookback });
    return c.json(reconcileRunResponseMapper(run, clock.now()), 202);
  };
}

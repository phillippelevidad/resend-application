import { createWorkerHandler } from './create-worker-handler.ts';
import { invocation, logger, worker } from './main.ts';

// The CDK entry (pp-infra): the adapter of D17 bound to what the composition root built once per
// container.
export const handler = createWorkerHandler({ worker, logger, invocation });

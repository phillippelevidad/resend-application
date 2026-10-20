import { createReconcilerHandler } from './create-reconciler-handler.ts';
import { invocation, logger, reconciler } from './main.ts';

// The CDK entry (pp-infra): the adapter of slice 4 D20 bound to what the composition root built once
// per container.
export const handler = createReconcilerHandler({ reconciler, logger, invocation });

import { createApiHandler } from './create-api-handler.ts';
import { app, invocation, logger } from './main.ts';

// The CDK entry (pp-infra): the adapter of D23 bound to what the composition root built once per
// container.
export const handler = createApiHandler({ app, logger, invocation });

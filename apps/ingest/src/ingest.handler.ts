import { createIngestHandler } from './create-ingest-handler.ts';
import { ingest, invocation, logger } from './main.ts';

// The CDK entry (pp-infra): the adapter of D14 bound to what the composition root built once per
// container.
export const handler = createIngestHandler({ ingest, logger, invocation });

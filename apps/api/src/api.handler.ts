import { handle } from '@hono/aws-lambda';
import { createApi } from '@ledger/api';

// Event adaptation only (ADR-013): the HTTP API event goes through @hono/aws-lambda to the app
// built once per container. Deployed from slice 2 (ADR-010).
export const handler = handle(createApi());

import { OpenAPIHono } from '@hono/zod-openapi';

// One Hono app object, served by @hono/aws-lambda and @hono/node-server alike (ADR-011, ADR-019).
// Routes land in slice 1, one createRoute per api-contract entry.
export function createApi(): OpenAPIHono {
  return new OpenAPIHono();
}

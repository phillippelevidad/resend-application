import { type createIngest, INGEST_CONTENT_TYPE } from '@ledger/ingest';

export type Ingest = ReturnType<typeof createIngest>;

// D32: adapts a fetch `Request` to ingest's domain input and its answer back to a `Response`, as
// slice 2's Lambda handler will adapt an HTTP API event. The body is read as bytes and decoded as
// UTF-8 with any BOM kept, so the signature is checked over the raw body byte for byte (RS-01).
export function ingestFetch(ingest: Ingest): (request: Request) => Promise<Response> {
  return async (request) => {
    const rawBody = Buffer.from(await request.arrayBuffer()).toString('utf8');
    const { status, body } = await ingest({
      rawBody,
      headers: {
        'svix-id': request.headers.get('svix-id') ?? undefined,
        'svix-timestamp': request.headers.get('svix-timestamp') ?? undefined,
        'svix-signature': request.headers.get('svix-signature') ?? undefined,
      },
    });
    // D11: the fixed bodies, so Resend stores nothing from the payload (RS-12).
    return new Response(body, { status, headers: { 'content-type': INGEST_CONTENT_TYPE } });
  };
}

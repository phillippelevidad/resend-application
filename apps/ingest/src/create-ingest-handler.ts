import { Buffer } from 'node:buffer';
import { errorRegistry } from '@ledger/core';
import { INGEST_CONTENT_TYPE, type IngestRequest, type IngestResponse } from '@ledger/ingest';
import { errorFields, LedgerError, type Logger } from '@ledger/shared';

// AWS-01: the fields of an API Gateway HTTP API payload 2.0 event this adapter reads. A narrow local
// declaration, not `@types/aws-lambda` (design Non-Goals). Header names arrive lowercase in 2.0.
export type HttpApiEvent = {
  readonly body?: string | undefined;
  readonly isBase64Encoded: boolean;
  readonly headers?: Readonly<Record<string, string | undefined>> | undefined;
};

// The one field of the Lambda context object the adapter reads (D6).
export type LambdaContext = { readonly awsRequestId: string };

// AWS-01: a payload 2.0 result. The body is always one of ingest's fixed constants (D11), never
// base64.
export type HttpApiResult = {
  readonly statusCode: IngestResponse['status'];
  readonly headers: { readonly 'content-type': typeof INGEST_CONTENT_TYPE };
  readonly body: string;
  readonly isBase64Encoded: false;
};

// D6: the per-container holder the logger's `context` reads on every line. One invocation runs per
// container at a time, so the handler overwrites it at the start of each one and lines never mix.
export type InvocationFields = { request_id: string | undefined; cold_start: boolean };

export type IngestHandlerDeps = {
  ingest: (request: IngestRequest) => Promise<IngestResponse>;
  logger: Logger;
  invocation: InvocationFields;
};

// D14: event adaptation only (ADR-013), apart from the composition root so a test drives it with no
// AWS client and no environment. `ingest.handler.ts` binds it to what `main.ts` built.
export function createIngestHandler({ ingest, logger, invocation }: IngestHandlerDeps) {
  let coldStart = true;

  return async (event: HttpApiEvent, context: LambdaContext): Promise<HttpApiResult> => {
    invocation.request_id = context.awsRequestId;
    invocation.cold_start = coldStart;
    coldStart = false;

    try {
      // D14 step 1, RS-01: the signature covers the exact bytes, so a base64 body is decoded before
      // verifying and a plain one is passed unchanged. Whether API Gateway encodes Resend's body is
      // AWS-U04, read from the line below on the verify delivery (D44).
      const encoded = event.isBase64Encoded;
      const body = event.body ?? '';
      const rawBody = encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      // D14 step 2: the encoding as a count, and no other request data.
      logger.info('ingest.request_decoded', { body_base64_count: encoded ? 1 : 0 });

      const headers = event.headers ?? {};
      const { status, body: answer } = await ingest({
        rawBody,
        headers: {
          'svix-id': headers['svix-id'],
          'svix-timestamp': headers['svix-timestamp'],
          'svix-signature': headers['svix-signature'],
        },
      });
      // D14 step 3, D11: the fixed bodies, so Resend stores nothing from the payload (RS-12).
      return {
        statusCode: status,
        headers: { 'content-type': INGEST_CONTENT_TYPE },
        body: answer,
        isBase64Encoded: false,
      };
    } catch (error) {
      // D14 step 4, AWS-U12: caught at the edge and logged by name; the rethrown error is a constant
      // with no `cause`, so nothing from the payload or an SDK message reaches Lambda's own error
      // output. API Gateway answers it with a `5xx`, which Resend retries (RS-10).
      logger.error('ingest.internal_error', { error_name: errorFields(error).error_name });
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }
  };
}

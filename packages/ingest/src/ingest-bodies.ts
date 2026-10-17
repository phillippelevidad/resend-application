// D11: the only bytes ingest ever answers with. Resend stores every response body it gets (RS-12,
// resend.md → Constraint 11), so none echoes the payload, a header, PII or a secret. Ingest is not an
// operation: the error shape does not apply (api-contract.md → Ingest boundary). Exported so each
// runtime's adapter (`apps/local` now, slice 2's Lambda) writes the same bytes and content type.
export const INGEST_BODY_OK = 'ok';
export const INGEST_BODY_UNAUTHORIZED = 'unauthorized';
export const INGEST_BODY_UNAVAILABLE = 'unavailable';
export const INGEST_CONTENT_TYPE = 'text/plain; charset=utf-8';

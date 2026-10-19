// @ledger/ingest: verify and enqueue, over the queue port (ADR-001, ADR-009). The package's one
// public surface.
export {
  createIngest,
  type IngestDeps,
  type IngestRequest,
  type IngestResponse,
} from './create-ingest.ts';
export {
  INGEST_BODY_OK,
  INGEST_BODY_UNAUTHORIZED,
  INGEST_BODY_UNAVAILABLE,
  INGEST_CONTENT_TYPE,
} from './ingest-bodies.ts';

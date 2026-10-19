import type { HealthRead } from './get-health.reader.ts';
import type { HealthResponse } from './health-response.schema.ts';

// `health.get`'s one mapper (pp-backend → Mappers): every wire field picked by name.
export function healthResponseMapper(read: HealthRead): HealthResponse {
  return {
    object: 'health',
    queue: {
      visible: read.queue.visible,
      in_flight: read.queue.inFlight,
      oldest_age_seconds: read.queue.oldestAgeSeconds,
    },
    dlq: { visible: read.queue.dlqVisible, in_flight: read.queue.dlqInFlight },
    event_source: { state: read.eventSourceState },
    database: {
      reachable: read.storageBytes !== null,
      storage_bytes: read.storageBytes,
      storage_limit_bytes: read.storageLimitBytes,
    },
  };
}

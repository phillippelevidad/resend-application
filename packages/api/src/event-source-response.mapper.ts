import type { EventSourceResponse } from './event-source-response.schema.ts';
import type { ResumeEventSourceResult } from './resume-event-source.command.ts';

// `worker.resumeEventSource`'s one mapper (pp-backend → Mappers).
export function eventSourceResponseMapper(result: ResumeEventSourceResult): EventSourceResponse {
  return { object: 'event_source', state: result.state, resumed: result.resumed };
}

import type { RedriveStart } from '@ledger/shared';
import type { DlqRedriveResponse } from './dlq-redrive-response.schema.ts';

// `dlq.startRedrive`'s one mapper (pp-backend → Mappers): the port's answer by name, so nothing else
// it might carry reaches the wire (AWS-61).
export function dlqRedriveResponseMapper(result: RedriveStart): DlqRedriveResponse {
  return { object: 'dlq_redrive', status: result.status, depth: result.depth };
}

import type { RecipientRead } from './get-recipient.reader.ts';
import type { RecipientResponse } from './recipient-response.schema.ts';

// `recipient.get`'s one mapper (pp-backend → Mappers): the input address is echoed only as the
// stored mask (api-contract.md → Conventions → Redaction).
export function recipientResponseMapper(read: RecipientRead): RecipientResponse {
  return {
    object: 'recipient',
    address_masked: read.addressMasked,
    deliverability: read.deliverability,
    since: read.since === null ? null : read.since.toISOString(),
    cause_email_id: read.causeEmailId,
  };
}

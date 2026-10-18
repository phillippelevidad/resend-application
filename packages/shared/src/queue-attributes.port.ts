// D1: the source queue and its DLQ as `health.get` reports them. Counts are approximate on SQS
// (AWS-22). `oldestAgeSeconds` is `null` when there is no message to age.
export type QueueSnapshot = {
  readonly visible: number;
  readonly inFlight: number;
  readonly oldestAgeSeconds: number | null;
  readonly dlqVisible: number;
  readonly dlqInFlight: number;
};

// D1: on AWS, `GetQueueAttributes` on both queues plus one CloudWatch statistic (`packages/aws`);
// locally, the in-process queue counts its own lists (D40).
export interface QueueAttributesPort {
  read(): Promise<QueueSnapshot>;
}

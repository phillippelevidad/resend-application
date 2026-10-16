# Logging, metrics and PII in code

Two surfaces leak: a log line that keeps an address for 30 days, and an output that shows one to
whoever asks. Both are cheap to get right when written, and PII exposure is a spend-anyway case
([lens clause 6](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). The rules
are [data-modeling.md → PII & retention](../../../../.ai/data-modeling.md#pii--retention) and its
[Log fields](../../../../.ai/data-modeling.md#log-fields) allow-list; this file owns the code
mechanics.

## Logger

One logger, Winston JSON, built in `packages/shared`. Every app logs through it.

- **Console transport to stdout only.** Never an HTTP, file or CloudWatch transport: an async or
  network transport can lose lines when Lambda freezes the environment. Two surfaces differ:
  `apps/mcp`, whose stdout is the JSON-RPC channel, routes every level to stderr (Winston Console
  `stderrLevels`, [pp-mcp → Output](../../pp-mcp/SKILL.md#output)); `apps/cli` logs nothing, since
  its output is its interface ([pp-cli → Output and exit codes](../../pp-cli/SKILL.md#output-and-exit-codes)).
- **Write `level`, `timestamp` and `request_id` yourself.** Winston's Console transport writes to
  `console._stdout` unless `forceConsole` is set
  ([source](https://raw.githubusercontent.com/winstonjs/winston/master/lib/winston/transports/console.js)),
  so Lambda adds none of its own fields to Winston output. Lambda does not re-encode a line that is
  already JSON, and its log-level filter needs a `level` key and a valid RFC 3339 `timestamp`;
  without one, it marks the line INFO
  ([AWS → Node.js logging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)). So the
  format writes the fields, and `forceConsole` stays off. Verify both against the installed Winston
  ([version rule](../SKILL.md#check-the-installed-version-not-memory)).
- **Every line carries** `level`, an RFC 3339 `timestamp`, `request_id` (from the Lambda context's
  `awsRequestId`, or the read API's request id), `function_name` and `cold_start`.
- **[Unverified]:** whether Lambda's level filter accepts Winston's lowercase level names (`info`,
  `warn`). Slice 2 checks it on the first deploy; if it does not, the format writes the uppercase
  name.
- **An allow-list, never a deny-list.** The logger keeps only the keys
  [Log fields](../../../../.ai/data-modeling.md#log-fields) allows and drops every other key, masks
  included. The allow-list is one constant in `packages/shared` that mirrors the doc. To log a new
  field, change the doc first, then the constant, in the same change. The slice 1 logger unit test
  is the evidence ([build-checklist → slice 1](../../../../.ai/build-checklist.md#1--local-ledger-and-read-path)).
- **Messages are constants, never interpolated.** `logger.info('event.duplicate', { svix_id })`,
  never `` logger.info(`duplicate ${svixId}`) ``. Interpolation is how a value the allow-list would
  drop slips into the one field it never inspects.
- **Errors are logged by name** (`error_name`), plus the registry code (`error_code`) for a
  `LedgerError` and the Postgres SQLSTATE (`pg_code`) when there is one. Never the
  error's `message`, `detail` or `cause` text: they can quote a row.

## Metrics

- **EMF JSON lines written by a small helper in `packages/shared`, no library.** `packages/shared`
  imports no AWS package, and EMF is a log format
  ([EMF spec](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)).
- **On Lambda, write the line with `process.stdout.write`**, not `console.log`: under the JSON log
  format CloudWatch does not parse EMF that `console.log` wrapped
  ([AWS → Node.js logging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)).
- **The set is fixed** in [architecture.md → Technology](../../../../.ai/architecture.md#technology).
  A new metric is a doc change first: every metric emitted in an hour costs money
  ([aws.md → CloudWatch and SNS](../../../../.ai/aws.md#cloudwatch-and-sns), AWS-12).
- **Ids are never dimensions** (AWS-12). The only dimension in the set is `ingest.rejected`'s
  `reason`. An EMF line carries the metric values, their dimensions and nothing that the log
  allow-list would drop.
- **Locally**, the same helper writes through the logger: the metric name is the constant message,
  its value a count or duration field.

## PII in code

The rule is "raw only in the ledger payload; everywhere else, a hash for lookup and a mask for
display" ([PII & retention](../../../../.ai/data-modeling.md#pii--retention)). In code that means:

- **One function each, in `packages/core`:** address normalization, the keyed address hash, the
  masks. Never a second implementation, never an inline `toLowerCase()` or HMAC. The hash key
  arrives as config; core never reads it from the environment ([config-and-env.md](config-and-env.md)).
- **An address travels only in a request body.** Never in a URL path or query string, a log line, a
  metric dimension, an error `message` or `hint`, exception text, an outbox payload or `last_error`,
  or MCP output ([api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)). The
  same holds for a subject and a display name.
- **The raw payload never leaves `webhook_events.payload`.** Every surface returns masks; an
  address sent as input is echoed only as its mask.
- **Mappers apply the masks.** A row or domain object reaches the wire only through an explicit
  `.mapper.ts` ([adding-things.md](adding-things.md#rejected-patterns)), so a new column cannot leak
  by passthrough.
- **Fixtures, tests and docs use Resend test addresses only** (`delivered@resend.dev`,
  `bounced@resend.dev`; [integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must),
  rule 10). The address grep in [boundaries.md](boundaries.md#review-greps) checks a diff.
- **A token, its hash, a secret or the address-hash key** never appears in a log, an error or an
  output; `token_id` is the only token field a log may carry ([Log fields](../../../../.ai/data-modeling.md#log-fields)).

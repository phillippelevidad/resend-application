import { internalError, type SdkError, type SdkResult } from '@ledger/sdk';
import { ConfigError } from '@ledger/shared';
import type { CliDeps } from './create-program.ts';

export type JsonOption = { json?: true };

// D28: the one path every command shares: build the client (which loads LEDGER_URL and
// LEDGER_TOKEN), call the SDK once, unwrap { data, error }, render, set the exit code (pp-cli →
// Output and exit codes).
export async function runOperation<T>(
  deps: CliDeps,
  options: JsonOption,
  call: (client: ReturnType<CliDeps['client']>) => Promise<SdkResult<T>>,
  render: (data: T) => string,
): Promise<void> {
  try {
    const { data, error } = await call(deps.client());
    if (error) {
      fail(deps, options, error);
      return;
    }
    if (options.json) deps.output.json(data);
    else deps.output.result(render(data));
  } catch (err) {
    // A config error is a usage error (exit 2, no call made), and a defect without --json prints
    // the constant line: both belong to exitCodeFor, the CLI's one exit mapping. A defect under
    // --json is the internal_error object, never the exception's text, stack or cause (O-12).
    if (err instanceof ConfigError || !options.json) throw err;
    fail(deps, options, internalError);
  }
}

// The SDK's error printed as received, wrapped once into the error shape (AGENTS.md → Error shape).
function fail(deps: CliDeps, options: JsonOption, error: SdkError): void {
  if (options.json) deps.output.json({ error });
  else deps.output.failure(error.message, error.hint);
  deps.setExitCode(1);
}

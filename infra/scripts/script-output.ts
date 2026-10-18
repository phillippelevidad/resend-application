// D33–D37: every `pnpm aws:*` line is prefixed with its script's name, and the last line is
// `<script>: done`, `<script>: refused: <constant reason>` or `<script>: failed: <constant reason>`,
// the last two exiting `1`. A reason names a variable, a check or a step, never a value: an error's
// text can quote a URL, a password or an account id, so no reason is built from one.

// Where a line goes: stdout for progress and `done`, stderr for `refused` and `failed`. A test
// passes a recorder.
export type ScriptSink = (stream: 'stdout' | 'stderr', text: string) => void;

export type ScriptOutput = {
  line(text: string): void;
  done(): 0;
  refused(reason: string): 1;
  failed(reason: string): 1;
};

export const processSink: ScriptSink = (stream, text) => {
  process[stream].write(text);
};

export function createScriptOutput(script: string, sink: ScriptSink): ScriptOutput {
  return {
    line: (text) => sink('stdout', `${script}: ${text}\n`),
    done: () => {
      sink('stdout', `${script}: done\n`);
      return 0;
    },
    refused: (reason) => {
      sink('stderr', `${script}: refused: ${reason}\n`);
      return 1;
    },
    failed: (reason) => {
      sink('stderr', `${script}: failed: ${reason}\n`);
      return 1;
    },
  };
}

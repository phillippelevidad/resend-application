// The one writer of stdout and stderr (pp-cli). Commands add `json`, `result`, `failure` and
// `notice` here when they land (slice 1); commander writes through `out` and `err`.

type Writer = { write(chunk: string): unknown };

export type Output = {
  out: (text: string) => void;
  err: (text: string) => void;
};

export function createOutput(streams: { stdout: Writer; stderr: Writer }): Output {
  return {
    out: (text) => {
      streams.stdout.write(text);
    },
    err: (text) => {
      streams.stderr.write(text);
    },
  };
}

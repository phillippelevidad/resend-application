// The one writer of stdout and stderr (pp-cli). Commander writes through `out` and `err`; commands
// write through `json`, `result`, `failure` and `notice`. No colour yet: nothing styled ships in
// slice 1, and `--json` is never styled.

type Writer = { write(chunk: string): unknown };

export type Output = {
  out: (text: string) => void;
  err: (text: string) => void;
  // One JSON document and a newline, to stdout.
  json: (value: unknown) => void;
  // A human layout, to stdout.
  result: (text: string) => void;
  // A registry error without `--json`: its message, then its hint, to stderr.
  failure: (message: string, hint: string) => void;
  // Progress or a notice, to stderr, so stdout stays the result only.
  notice: (text: string) => void;
};

const withNewline = (text: string): string => (text.endsWith('\n') ? text : `${text}\n`);

// C0, DEL and C1: a payload string (a bounce type, a masked subject) can carry a terminal escape.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// D34: every value a human layout or a failure line prints passes through here. `null` prints as
// an em dash.
export function printable(value: string | number | null): string {
  if (value === null) return '—';
  return String(value).replace(CONTROL_CHARACTERS, '*');
}

// `JSON.stringify` escapes C0 only, so DEL and C1 (U+009B is a one-character CSI) would reach the
// terminal raw. Outside a JSON string they cannot occur, so `\u` escapes keep the document and every
// value identical while nothing executes.
const UNESCAPED_CONTROLS = /[\u007f-\u009f]/g;
const escapeControls = (json: string): string =>
  json.replace(UNESCAPED_CONTROLS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function createOutput(streams: { stdout: Writer; stderr: Writer }): Output {
  return {
    out: (text) => {
      streams.stdout.write(text);
    },
    err: (text) => {
      streams.stderr.write(text);
    },
    json: (value) => {
      streams.stdout.write(`${escapeControls(JSON.stringify(value, null, 2))}\n`);
    },
    result: (text) => {
      streams.stdout.write(withNewline(text));
    },
    failure: (message, hint) => {
      streams.stderr.write(`${printable(message)}\nhint: ${printable(hint)}\n`);
    },
    notice: (text) => {
      streams.stderr.write(withNewline(printable(text)));
    },
  };
}

// D5: a configuration the boot assertion rejected. It names each failing variable and what it
// expects, never the value, because a value can be a secret or a database URL. The CLI exits `2` on
// it and `apps/local` exits `1`.
export type ConfigIssue = { readonly variable: string; readonly expected: string };

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid configuration: ${issues.map((issue) => `${issue.variable} (${issue.expected})`).join('; ')}.`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

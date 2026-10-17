import type { z } from 'zod';
import { ConfigError } from './config.error.ts';

export type Env = Readonly<Record<string, string | undefined>>;

// D6: the boot assertion each composition root runs once over `process.env`. A failure names each
// failing path and its expectation, never a value. The expectation is the Zod issue's message: Zod
// 4's default messages name the expected and received types, never the input, and `reportInput`
// stays off, so no issue carries the value either.
export const loadConfig = <Schema extends z.ZodType>(
  schema: Schema,
  env: Env,
): z.output<Schema> => {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.map(String).join('.') : '(config)',
      expected: issue.message,
    })),
  );
};

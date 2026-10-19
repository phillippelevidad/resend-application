// D1: how a function reads a secret's value at runtime (pp-general → config-and-env, Secrets). On AWS,
// Secrets Manager by the ARN in an internal variable (`packages/aws`); locally, a static
// implementation over the values the config parsed, so a factory always takes the port. `read`
// rejects when the value cannot be read; the caller decides what that means (ingest answers `503`).
export interface SecretReaderPort {
  read(secretId: string): Promise<string>;
}

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

// Local mode skips the token check in slice 1, so it may bind only to loopback
// (api-contract.md → Conventions, Auth in slice 1).
export function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host);
}

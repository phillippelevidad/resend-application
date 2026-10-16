import { McpServer } from '@modelcontextprotocol/server';

// The published name waits for slice 8 (pp-mcp).
export const SERVER_NAME = 'ledger';
export const SERVER_VERSION = '0.0.0';

// The one server factory main.ts serves and the tests build (pp-mcp). Tools register here from
// slice 5, one apps/mcp/src/tools/<tool-name>.tool.ts each, selected once at startup.
export function createServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
}

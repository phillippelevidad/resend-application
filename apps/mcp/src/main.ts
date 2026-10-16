// @ledger/app-mcp: the MCP server, built on the SDK. Composition root (pp-mcp).
// stdout is the JSON-RPC channel: nothing in this app writes to it but the transport.
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './create-server.ts';

// Strict, so an unknown flag throws on stderr and exits non-zero before serving. The flag set is
// api-contract's; --enable-operate lands with the operate tools in slice 5.
parseArgs({ options: {}, strict: true, allowPositionals: false });

const handle = serveStdio(createServer);
// On stdin EOF the transport closes itself; Ctrl-C closes it here.
process.once('SIGINT', () => {
  void handle.close();
});

#!/usr/bin/env node
// engine/src/apps/socialShims/x/main.ts -- SUB-9's stdio MCP entry point for X (Twitter), spawned
// by apps/toolsLib/mcpConfig.ts in place of the Python original (`python -m
// backend.apps.x_mcp_shim`). Compiled to dist/apps/socialShims/x/main.js.

import { runStdioMcpServer } from '../common/mcpStdioServer';
import { handleToolCall } from './handlers';
import { TOOLS } from './tools';

runStdioMcpServer({ serverName: 'maestro-x', tools: TOOLS, handleToolCall }).catch((e: unknown) => {
  process.stderr.write(`[x-mcp-shim] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

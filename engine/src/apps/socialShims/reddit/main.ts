#!/usr/bin/env node
// engine/src/apps/socialShims/reddit/main.ts -- SUB-9's stdio MCP entry point for Reddit, spawned
// by apps/toolsLib/mcpConfig.ts in place of the Python original (`python -m
// backend.apps.reddit_mcp_shim`). Compiled to dist/apps/socialShims/reddit/main.js.

import { runStdioMcpServer } from '../common/mcpStdioServer';
import { handleToolCall } from './handlers';
import { TOOLS } from './tools';

runStdioMcpServer({ serverName: 'maestro-reddit', tools: TOOLS, handleToolCall }).catch((e: unknown) => {
  process.stderr.write(`[reddit-mcp-shim] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

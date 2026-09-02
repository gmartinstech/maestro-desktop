#!/usr/bin/env node
// engine/src/apps/socialShims/tiktok/main.ts -- SUB-9's stdio MCP entry point for TikTok, spawned
// by apps/toolsLib/mcpConfig.ts in place of the Python original (`python -m
// backend.apps.tiktok_mcp_shim`). Compiled to dist/apps/socialShims/tiktok/main.js.

import { runStdioMcpServer } from '../common/mcpStdioServer';
import { handleToolCall } from './handlers';
import { TOOLS } from './tools';

runStdioMcpServer({ serverName: 'maestro-tiktok', tools: TOOLS, handleToolCall }).catch((e: unknown) => {
  process.stderr.write(`[tiktok-mcp-shim] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

#!/usr/bin/env node
// engine/src/apps/socialShims/discord/main.ts -- SUB-9's stdio MCP entry point for Discord, spawned
// by apps/toolsLib/mcpConfig.ts's derive_mcp_config in place of the Python original
// (`python -m backend.apps.discord_mcp_shim`). Compiled to dist/apps/socialShims/discord/main.js and
// invoked as `node <that path>` -- stdlib-plus-fastify-adjacent-only (no MCP SDK), matching the
// Python original's own "starts fast" design goal.

import { runStdioMcpServer } from '../common/mcpStdioServer';
import { handleToolCall } from './handlers';
import { TOOLS } from './tools';

runStdioMcpServer({ serverName: 'maestro-discord', tools: TOOLS, handleToolCall }).catch((e: unknown) => {
  process.stderr.write(`[discord-mcp-shim] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

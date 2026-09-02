// engine/src/apps/socialShims/common/mcpStdioServer.ts -- SUB-9. Factors the byte-for-byte-identical
// stdio JSON-RPC loop that backend/apps/{discord,reddit,tiktok,x}_mcp_shim/server.py each hand-roll
// independently (initialize / notifications.initialized / tools.list / tools.call / ping / unknown
// method), plus the mcp_ok/mcp_err content-formatting helpers each shim's own handlers.py
// duplicates. A single shared implementation here, not four copies -- these processes never share
// runtime state (each is spawned as its own subprocess), so this is a pure de-duplication, not a
// behavior change: every one of the four ported main.ts entry points calls this with its own
// (tools, dispatch) pair, and the wire behavior for each is unchanged from its Python original.

import * as readline from 'node:readline';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function mcpOk(payload: unknown): McpToolResult {
  if (typeof payload === 'string') return { content: [{ type: 'text', text: payload }] };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function mcpErr(text: string): McpToolResult {
  return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function send(write: (line: string) => void, id: unknown, result?: unknown, error?: { code: number; message: string }): void {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', id };
  if (error !== undefined) msg.error = error;
  else msg.result = result;
  write(JSON.stringify(msg));
}

export interface StdioServerConfig {
  serverName: string;
  version?: string;
  tools: readonly McpTool[];
  handleToolCall: (name: string, args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
}

export interface StdioServerIo {
  /** One raw stdio line at a time -- an async iterable so both a real `readline.createInterface`
   * and a test's fake line source satisfy it identically. */
  lines: AsyncIterable<string>;
  write: (line: string) => void;
}

/** Real stdin/stdout IO for a shim's actual `main()` entry point. */
export function realStdioIo(): StdioServerIo {
  return {
    lines: readline.createInterface({ input: process.stdin, terminal: false }),
    write: (line: string) => {
      process.stdout.write(line + '\n');
    },
  };
}

/** Drives one shim's stdio JSON-RPC loop end-to-end -- direct twin of every Python
 * `server.py`'s `main()`. Each line is a JSON-RPC request; malformed lines are silently skipped
 * (matches the Python original's `except json.JSONDecodeError: continue`), and a tool-call handler
 * that throws is caught and surfaced as an MCP error result rather than crashing the subprocess
 * (`except Exception as e: p_send(id_, mcp_err(f"shim crashed: {e!r}"))`). */
export async function runStdioMcpServer(config: StdioServerConfig, io: StdioServerIo = realStdioIo()): Promise<void> {
  for await (const rawLine of io.lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    const { method, id, params } = msg;

    if (method === 'initialize') {
      send(io.write, id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: config.serverName, version: config.version ?? '1.0.0' },
      });
    } else if (method === 'notifications/initialized') {
      // no reply, matches the Python original's `pass`
    } else if (method === 'tools/list') {
      send(io.write, id, { tools: config.tools });
    } else if (method === 'tools/call') {
      const name = params?.name ?? '';
      const args = params?.arguments ?? {};
      try {
        send(io.write, id, await config.handleToolCall(name, args));
      } catch (e) {
        send(io.write, id, mcpErr(`shim crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
      }
    } else if (method === 'ping') {
      send(io.write, id, {});
    } else if (id !== undefined) {
      send(io.write, id, undefined, { code: -32601, message: `Method not found: ${method}` });
    }
  }
}

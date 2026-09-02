// engine/src/apps/toolsLib/mcpDiscovery.ts -- SUB-4, a full port of
// backend/apps/tools_lib/mcp_discovery.py's HTTP transport, and a careful, real port of its stdio
// transport: THIS is the file that actually SPAWNS a vendored MCP bundle (backend/mcp-bundles/**,
// npm-installed servers, uvx/uv Python MCP servers, ...) and talks JSON-RPC over its stdin/stdout,
// per the ticket's own warning that process spawn/lifecycle is the single riskiest class of code in
// this migration. Every lesson embedded in the Python original is preserved deliberately, not
// simplified away:
//   - stderr is drained continuously in the background (not read only after exit): the OS pipe
//     buffer is ~64KB, and a cold `npx -y <pkg>` install can print more than that while an AV
//     scanner slows every file npm writes -- an undrained pipe means the child blocks on write and
//     looks like a hang from our side.
//   - on stdout EOF (child exited), we wait briefly for the stderr drain to catch up (the real
//     failure reason often lands a few ms after stdout closes) before surfacing an error with the
//     stderr tail attached.
//   - a corrupted `~/.npm/_npx/<hash>/` cache (an interrupted install leaves a package-lock.json
//     that makes subsequent spawns reuse a partially-extracted node_modules tree) is healed by
//     wiping exactly that one hash subdirectory and retrying ONCE.
//   - cleanup always runs (stdin closed, stderr drain cancelled+awaited, terminate() then a bounded
//     wait then a hard kill) so a discovery call can never leak a running child, mirroring the
//     SIGTERM-then-SIGKILL-after-timeout pattern router/process.ts's stop() already established for
//     the 9Router child.
//
// SSE transport (discover_mcp_tools_sse, the legacy GET-event-stream + POST-messages shape) is a
// DELIBERATE SCOPE CUT: the Python original delegates it entirely to the `mcp` Python SDK's
// sse_client/ClientSession, engine/ has no equivalent MCP client SDK dependency, and no backend
// test exercises this transport (grepped backend/tests/ -- zero references to
// discover_mcp_tools_sse). A caller hitting a server that only speaks legacy SSE gets a clear
// "transport not supported" error here rather than a silent wrong answer; re-implementing the
// stream-pairing protocol by hand is real, additional scope for whoever needs it.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { engineFetch } from '../../net/http';
import { augmentedPath, resolveCommand } from './mcpConfig';

export class McpDiscoveryError extends Error {
  constructor(
    public readonly statusCode: number,
    detail: string,
  ) {
    super(detail);
  }
}

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

function parseSseJson(text: string): unknown {
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.startsWith('data:')) {
      const payload = stripped.slice('data:'.length).trim();
      if (payload) {
        try {
          return JSON.parse(payload);
        } catch {
          continue;
        }
      }
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface JsonRpcToolsListResult {
  result?: { tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }> };
}

function extractTools(data: JsonRpcToolsListResult): DiscoveredMcpTool[] {
  const toolsList = data.result?.tools ?? [];
  return toolsList.map((t) => ({ name: t.name ?? '', description: t.description ?? '', inputSchema: t.inputSchema }));
}

/** Connect to a Streamable HTTP MCP server and call tools/list via JSON-RPC POST. The target host
 * is data the user typed into their own Tools settings (a community MCP server's URL), not a host
 * this codebase hardcodes -- see net/http.ts's `allowArbitraryHost` doc for why this is the one
 * legitimate escape hatch from the provider-egress allowlist. */
export async function discoverMcpToolsHttp(url: string, headers?: Record<string, string> | null): Promise<DiscoveredMcpTool[]> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(headers || {}),
  };

  const initResp = await engineFetch(
    url,
    {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'maestro', version: '0.1.0' } },
      }),
    },
    { allowArbitraryHost: true },
  );
  if (initResp.status !== 200 && initResp.status !== 201) {
    throw new McpDiscoveryError(502, `MCP initialize failed: ${initResp.status}`);
  }

  const sessionId = initResp.headers.get('mcp-session-id') ?? '';
  if (sessionId) h['mcp-session-id'] = sessionId;

  await engineFetch(
    url,
    { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) },
    { allowArbitraryHost: true },
  );

  const listResp = await engineFetch(
    url,
    { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) },
    { allowArbitraryHost: true },
  );
  if (listResp.status !== 200 && listResp.status !== 201) {
    throw new McpDiscoveryError(502, `MCP tools/list failed: ${listResp.status}`);
  }

  const ct = listResp.headers.get('content-type') ?? '';
  let data: JsonRpcToolsListResult | null;
  if (ct.includes('text/event-stream')) {
    data = parseSseJson(await listResp.text()) as JsonRpcToolsListResult | null;
  } else {
    data = (await listResp.json()) as JsonRpcToolsListResult;
  }
  if (!data) throw new McpDiscoveryError(502, 'Empty response from MCP server');
  return extractTools(data);
}

/** Legacy SSE transport -- see this file's header for why it's a deliberate scope cut. */
export async function discoverMcpToolsSse(_url: string, _headers?: Record<string, string> | null): Promise<DiscoveredMcpTool[]> {
  throw new McpDiscoveryError(
    501,
    'Legacy SSE MCP transport is not supported by this engine port yet (SUB-4 scope cut, no MCP client SDK dependency) -- use a Streamable HTTP or stdio server instead.',
  );
}

const NPX_CACHE_RE = /_npx[/\\]([0-9a-f]{8,})[/\\]/;

/** On `ERR_MODULE_NOT_FOUND` pointing into `~/.npm/_npx/<hash>/`, wipe that one dir. Why: an
 * interrupted npx install leaves a package-lock.json in the cache dir so subsequent spawns reuse a
 * partially-extracted node_modules tree, which dies at import time. Scoped strictly to the
 * extracted hash subdir; never touches anything outside `~/.npm/_npx/`. */
export function tryHealNpxCache(stderr: string): string | null {
  if (!stderr.includes('ERR_MODULE_NOT_FOUND')) return null;
  const m = NPX_CACHE_RE.exec(stderr);
  if (!m) return null;
  const hash = m[1];
  const cacheDir = join(homedir(), '.npm', '_npx', hash);
  if (!existsSync(cacheDir)) return null;
  console.warn(`Corrupted npx cache detected at ${cacheDir}; wiping and letting caller retry`);
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // best-effort, mirrors shutil.rmtree(ignore_errors=True)
  }
  return hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Race a promise against a timeout; rejects with a TimedOutError on expiry (the promise itself
 * keeps running -- callers that need to abort it do so via their own AbortController/kill path). */
class TimedOutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOutError('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: unknown;
  [k: string]: unknown;
}

/** Spawn a stdio MCP server process and call tools/list via JSON-RPC over stdin/stdout.
 *
 * On the first attempt, a failure that looks like corrupted npx cache triggers one auto-heal +
 * retry. No heal on the retry attempt. */
export async function discoverMcpToolsStdio(
  command: string,
  args?: string[] | null,
  env?: Record<string, string> | null,
  attempt = 0,
): Promise<DiscoveredMcpTool[]> {
  const cmdPath = resolveCommand(command);
  if (!cmdPath) {
    throw new McpDiscoveryError(400, `Command '${command}' not found on PATH or common install locations`);
  }

  const procEnv: Record<string, string> = { ...(process.env as Record<string, string>), ...(env ?? {}), PATH: augmentedPath() };
  delete procEnv.PYTHONPATH;
  if (env && env.PYTHONPATH !== undefined) procEnv.PYTHONPATH = env.PYTHONPATH;

  const proc: ChildProcessWithoutNullStreams = spawn(cmdPath, args ?? [], { env: procEnv, stdio: ['pipe', 'pipe', 'pipe'] });

  // Drain stderr in the background -- see this file's header for why (OS pipe buffer size, and
  // surfacing npx's own diagnostic in whatever error we raise).
  const stderrTail: string[] = [];
  let stderrDrainDone: Promise<void>;
  {
    const rl = createInterface({ input: proc.stderr, crlfDelay: Infinity });
    stderrDrainDone = (async () => {
      try {
        for await (const line of rl) {
          stderrTail.push(`${line}\n`);
          if (stderrTail.length > 50) stderrTail.splice(0, stderrTail.length - 50);
        }
      } catch {
        // best-effort, mirrors the Python original's broad except: return
      }
    })();
  }

  const stdoutLines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const stdoutIterator = stdoutLines[Symbol.asyncIterator]();
  let stdoutEnded = false;

  async function send(msg: Record<string, unknown>): Promise<void> {
    const line = `${JSON.stringify(msg)}\n`;
    await new Promise<void>((resolve, reject) => {
      proc.stdin.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Read JSON-RPC responses, skipping notification lines (no 'id' field). */
  async function recv(timeoutMs: number): Promise<JsonRpcResponse> {
    while (true) {
      const next = await withTimeout(stdoutIterator.next(), timeoutMs);
      if (next.done) {
        stdoutEnded = true;
        // stdout EOF = child exited. Wait briefly for the stderr drain to catch up so we capture the
        // real failure reason (which often arrives a few ms after stdout closes).
        await Promise.race([stderrDrainDone, sleep(1000)]).catch(() => {});
        const tail = stderrTail.slice(-10).join('').trim();
        throw new McpDiscoveryError(502, `MCP stdio process exited unexpectedly${tail ? `: ${tail}` : ''}`);
      }
      const stripped = next.value.trim();
      if (!stripped) continue;
      let data: JsonRpcResponse;
      try {
        data = JSON.parse(stripped) as JsonRpcResponse;
      } catch {
        continue;
      }
      if ('id' in data) return data;
    }
  }

  async function cleanup(): Promise<void> {
    try {
      proc.stdin.end();
    } catch {
      // already closed
    }
    try {
      proc.kill('SIGTERM');
      const exited = await withTimeout(
        new Promise<void>((resolve) => proc.once('exit', () => resolve())),
        5000,
      ).then(
        () => true,
        () => false,
      );
      if (!exited) proc.kill('SIGKILL');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    // Let the stderr drain settle (bounded) so its readline interface doesn't outlive the process.
    await Promise.race([stderrDrainDone, sleep(200)]).catch(() => {});
  }

  try {
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'maestro', version: '0.1.0' } },
    });
    // First response is the slow one -- see this file's header (cold npx cache on Windows can push
    // install time past 90s). Subsequent reads run against an already-running server.
    await recv(120_000);

    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const data = await recv(30_000);

    const toolsList = ((data.result as { tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }> } | undefined)?.tools) ?? [];
    return toolsList.map((t) => ({ name: t.name ?? '', description: t.description ?? '', inputSchema: t.inputSchema }));
  } catch (e) {
    if (e instanceof McpDiscoveryError) {
      if (attempt === 0 && tryHealNpxCache(e.message)) {
        await cleanup();
        return discoverMcpToolsStdio(command, args, env, 1);
      }
      throw e;
    }
    if (e instanceof TimedOutError) {
      const tailText = stderrTail.slice(-5).join('').trim();
      let detail = 'MCP discovery timed out; the server may still be downloading on first run';
      if (tailText) {
        const preview = tailText.slice(-200).replace(/\n/g, ' ').trim();
        detail += ` (last output: ${preview})`;
      }
      detail += '. Try again in a moment.';
      throw new McpDiscoveryError(504, detail);
    }
    throw e;
  } finally {
    void stdoutEnded;
    await cleanup();
  }
}

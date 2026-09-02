// engine/src/apps/socialShims/googleWorkspace/capToolResult.ts -- SUB-9, a full port of the PURE
// half of backend/apps/google_workspace_mcp_shim/cap_tool_result.py's cap_tool_result: caps the
// cumulative text of an MCP call_tool return so one Gmail/Drive dump can't blow the model's
// context, spilling the full text to a report file the model can Read selectively.
//
// SCOPE NOTE, read before wondering why there's no main.ts here (unlike discord/reddit/tiktok/x):
// backend/apps/google_workspace_mcp_shim/run.py -- the actual MCP server entry point this helper
// wraps -- is NOT a hand-rolled stdio loop like the other four shims. It in-process
// monkey-patches `google_workspace_mcp.auth.gauth.get_credentials` (so the upstream PyPI package's
// OAuth token refresh points at our local proxy) and then imports and runs that SAME upstream
// package's own FastMCP server (`google_workspace_mcp.app.mcp`, installed at spawn time via `uv run
// --with google-workspace-mcp`). There is no equivalent to monkey-patch in this engine -- the thing
// being patched is a third-party PyPI package's module-level function, tens of thousands of lines
// of Google API tool implementations that live nowhere in this repository and have no npm twin.
// "Porting" run.py would mean reimplementing google-workspace-mcp itself, which is out of this
// ticket's (and this migration's) scope by any reading of it.
//
// apps/toolsLib/mcpConfig.ts (SUB-4) already made and documented this exact call for the OTHER
// half of Google Workspace's spawn config ("Python-only -- there is no TS twin to invoke here, so
// this stays a Python subprocess exactly like the original") -- this file doesn't reopen that
// decision, it's the one piece of run.py's OWN logic (not the wrapped package's) that IS pure,
// stdlib-only, and independently testable, so it's ported for completeness and as a ready
// reference for whoever might someday reimplement the Google Workspace integration natively.
// run.py itself is untouched, still spawned exactly as SUB-4 wired it.

import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_RESULT_CHARS = 48_000;

function reportDir(): string {
  // Deliberately not routed through any engine data-root helper: the Python original runs as a
  // standalone subprocess with no `backend` importable, spilling to a fixed `~/.maestro/tool-reports`
  // dir -- mirrored here via MAESTRO_TOOL_REPORT_DIR with the same fallback, not this process's own
  // conventions, since a future spawn of this logic would face the identical constraint.
  return process.env.MAESTRO_TOOL_REPORT_DIR || join(process.env.HOME || process.env.USERPROFILE || tmpdir(), '.maestro', 'tool-reports');
}

function truncationNote(cap: number, saved: string): string {
  return `\n\n[Truncated: this tool returned more than ${cap} characters, too much to fit in context at once.${saved} Narrow the request (add a search filter, a date range, or a smaller max_results / page size) or fetch the next page.]`;
}

/** Write the full result to disk so the cap is lossless; empty string on failure. */
function spill(text: string): string {
  try {
    const dir = reportDir();
    mkdirSync(dir, { recursive: true });
    // Reports are point-in-time working files, not archives; prune week-old ones so the folder
    // can't grow forever.
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const old of readdirSync(dir)) {
      const p = join(dir, old);
      try {
        if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
      } catch {
        // best-effort prune, matches the Python original's own except OSError: pass
      }
    }
    const path = join(dir, `gws-result-${process.pid}-${Date.now()}.txt`);
    writeFileSync(path, text, 'utf8');
    return path;
  } catch {
    return '';
  }
}

export interface TextBlock {
  type?: string;
  text?: string;
}

/** Cap the text content blocks of an MCP call_tool return in place. Duck-typed and fail-open: any
 * shape not recognized passes through unchanged, so an upstream contract change degrades to
 * no-cap, never a crash. */
export function capToolResult<T extends { content?: TextBlock[] } | TextBlock[]>(result: T, maxChars: number = MAX_RESULT_CHARS): T {
  try {
    const blocks: TextBlock[] | undefined = Array.isArray(result) ? result : result?.content;
    if (!Array.isArray(blocks)) return result;
    const texts = blocks.filter((b) => b?.type === 'text' && b.text !== undefined && b.text !== null).map((b) => b.text as string);
    const totalLen = texts.reduce((sum, t) => sum + t.length, 0);
    if (totalLen <= maxChars) return result;
    const fullPath = spill(texts.join('\n'));
    const saved = fullPath ? ` The complete result was saved to ${fullPath}; Read it with offset/limit if you truly need the rest.` : '';
    let used = 0;
    let truncated = false;
    for (const b of blocks) {
      if (b?.type !== 'text' || b.text === undefined || b.text === null) continue;
      if (truncated) {
        b.text = '';
        continue;
      }
      const text = b.text;
      if (used + text.length <= maxChars) {
        used += text.length;
        continue;
      }
      b.text = text.slice(0, Math.max(0, maxChars - used)) + truncationNote(maxChars, saved);
      truncated = true;
    }
    return result;
  } catch {
    return result;
  }
}

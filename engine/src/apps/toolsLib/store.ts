// engine/src/apps/toolsLib/store.ts -- SUB-4, a full port of the on-disk persistence half of
// backend/apps/tools_lib/tools_lib.py: one JSON file per configured MCP tool under
// DATA_ROOT/tools, the builtin_permissions.json / trusted_sensitive_paths.json singletons, the
// stat-signature read cache (load_all_tools runs on every dispatch/prompt build/MCPSearch
// keystroke), and resolve_policy_slot -- the single source of truth for WHERE a tool's permission
// policy lives, shared by the dispatch gate (read) and the "Always approve" writer (write) so they
// can never key it differently (see test_tool_policy_slot.py's own header for the bug this
// prevents; ported 1:1 below and re-asserted by store.test.ts).

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';
import { sanitizeServerName } from './mcpConfig';
import { BUILTIN_TOOLS, makeToolDefinition, type ToolDefinition } from './models';
import { classifyServices } from './toolTaxonomy';

export class ToolsLibHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    detail: string,
  ) {
    super(detail);
  }
}

// Three independent overridable path slots, mirroring backend/config/paths.py's TOOLS_DIR /
// BUILTIN_PERMISSIONS_PATH / TRUSTED_SENSITIVE_PATHS_PATH being three separate module-level
// constants -- the Python test suite monkeypatches each attribute independently
// (test_tool_policy_slot.py's `monkeypatch.setattr(tl, "BUILTIN_PERMS_PATH", ...)` is not derived
// from DATA_DIR), so these stay independent overrides rather than one derived from another.
let dataDirOverride: string | null = null;
let builtinPermsPathOverride: string | null = null;
let trustedPathsPathOverride: string | null = null;

/** Test-only: pins DATA_DIR to a throwaway directory, mirroring the Python suite's
 * `monkeypatch.setattr(tools_lib, "DATA_DIR", str(d))`. */
export function setToolsDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
  invalidateCacheForTests();
}

/** Test-only: pins BUILTIN_PERMS_PATH, mirroring `monkeypatch.setattr(tl, "BUILTIN_PERMS_PATH", ...)`. */
export function setBuiltinPermissionsPathForTests(path: string | null): void {
  builtinPermsPathOverride = path;
}

/** Test-only: pins TRUSTED_SENSITIVE_PATHS_PATH. */
export function setTrustedSensitivePathsPathForTests(path: string | null): void {
  trustedPathsPathOverride = path;
}

export function toolsDataDir(): string {
  return dataDirOverride ?? join(resolveDataRoot(), 'tools');
}

/** backend/config/paths.py's BUILTIN_PERMISSIONS_PATH = DATA_ROOT/builtin_permissions.json. */
export function builtinPermissionsPath(): string {
  return builtinPermsPathOverride ?? join(resolveDataRoot(), 'builtin_permissions.json');
}

/** backend/config/paths.py's TRUSTED_SENSITIVE_PATHS_PATH = DATA_ROOT/trusted_sensitive_paths.json. */
export function trustedSensitivePathsPath(): string {
  return trustedPathsPathOverride ?? join(resolveDataRoot(), 'trusted_sensitive_paths.json');
}

// Tool JSONs total ~1.5MB and load_all_tools runs on every dispatch, prompt build, and MCPSearch
// keystroke; the cache skips re-parsing, revalidated by a per-file stat signature so any write
// (ours or external) invalidates instantly. Callers treat the returned ToolDefinitions as
// immutable; mutate via load(id) + save.
let toolsCache: ToolDefinition[] | null = null;
let toolsCacheSig: string | null = null;

export function invalidateCacheForTests(): void {
  toolsCache = null;
  toolsCacheSig = null;
}

function toolsSig(): string | null {
  if (!existsSync(toolsDataDir())) return '';
  try {
    const entries: string[] = [];
    for (const fname of readdirSync(toolsDataDir()).sort()) {
      if (fname.endsWith('.json')) {
        const st = statSync(join(toolsDataDir(), fname));
        entries.push(`${fname}:${st.mtimeMs}:${st.size}`);
      }
    }
    return entries.join('|');
  } catch {
    return null;
  }
}

export function loadAllTools(): ToolDefinition[] {
  const sig = toolsSig();
  if (sig !== null && toolsCache !== null && sig === toolsCacheSig) return [...toolsCache];
  const result: ToolDefinition[] = [];
  if (!existsSync(toolsDataDir())) return result;
  for (const fname of readdirSync(toolsDataDir())) {
    if (fname.endsWith('.json')) {
      const raw = JSON.parse(readFileSync(join(toolsDataDir(), fname), 'utf8')) as Record<string, unknown>;
      result.push(makeToolDefinition(raw as unknown as { name: string }));
    }
  }
  if (sig !== null) {
    toolsCache = [...result];
    toolsCacheSig = sig;
  }
  return result;
}

export function saveTool(tool: ToolDefinition): void {
  mkdirSync(toolsDataDir(), { recursive: true });
  writeFileSync(join(toolsDataDir(), `${tool.id}.json`), JSON.stringify(tool, null, 2));
}

/** Load one tool by id, migrating a legacy Discord npx-based mcp_config to the local Python shim
 * (idempotent; no-op once already on the shim). Throws ToolsLibHttpError(404) when missing. */
export function loadTool(toolId: string): ToolDefinition {
  const path = join(toolsDataDir(), `${toolId}.json`);
  if (!existsSync(path)) throw new ToolsLibHttpError(404, 'Tool not found');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const tool = makeToolDefinition(raw as unknown as { name: string });
  const cfg = tool.mcp_config as Record<string, unknown>;
  if (
    tool.name.toLowerCase() === 'discord' &&
    cfg &&
    cfg.command === 'npx' &&
    Array.isArray(cfg.args) &&
    (cfg.args as unknown[]).some((a) => String(a).includes('mcp-discord'))
  ) {
    tool.mcp_config = { type: 'stdio', command: 'python', args: ['-m', 'backend.apps.discord_mcp_shim'] };
    saveTool(tool);
  }
  return tool;
}

export function deleteTool(toolId: string): void {
  const path = join(toolsDataDir(), `${toolId}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function loadBuiltinPermissions(): Record<string, string> {
  const path = builtinPermissionsPath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

export function saveBuiltinPermissions(perms: Record<string, string>): void {
  const path = builtinPermissionsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(perms, null, 2));
}

export function loadTrustedSensitivePaths(): string[] {
  const path = trustedSensitivePathsPath();
  if (!existsSync(path)) return [];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const raw = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).patterns : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function saveTrustedSensitivePaths(patterns: string[]): void {
  const seen: string[] = [];
  for (const p of patterns) {
    if (typeof p === 'string' && p && !seen.includes(p)) seen.push(p);
  }
  const path = trustedSensitivePathsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ patterns: seen }, null, 2));
}

// One-time marker: older installs seeded Bash="ask"; we lift them once.
function bashAutoallowMarkerPath(): string {
  return join(toolsDataDir(), '.bash_autoallow_migrated');
}

/** Seed BUILTIN_PERMISSIONS_PATH so the user's Settings toggles persist cleanly. Without this the
 * file is missing on first run, load returns {}, every PUT-from-the-UI overwrites with the partial
 * payload the click sent, and the user never sees their preferred policy stick. Idempotent: merges
 * current defaults in for any tool missing from an existing file, never clobbers a policy the user
 * already set. */
export function ensureDefaultPermissions(): void {
  const existing = loadBuiltinPermissions();
  const desired: Record<string, string> = {};
  for (const t of BUILTIN_TOOLS) desired[t.name] = 'always_allow';
  const merged = { ...desired, ...existing };
  // One-time lift: installs seeded under the old default carry Bash="ask"; raise them to
  // always_allow once so shell commands stop prompting. The marker means a deliberate "ask" set
  // afterward sticks (never re-flipped).
  const markerPath = bashAutoallowMarkerPath();
  if (!existsSync(markerPath)) {
    if (merged.Bash === 'ask') merged.Bash = 'always_allow';
    try {
      mkdirSync(toolsDataDir(), { recursive: true });
      writeFileSync(markerPath, '1');
    } catch {
      // best-effort, matches the Python original's except OSError: pass.
    }
  }
  if (JSON.stringify(merged) !== JSON.stringify(existing)) saveBuiltinPermissions(merged);
}

/** One-time correction for tools discovered before service rules were integration-scoped: most
 * integrations got mislabeled under a bogus 'Google' group (generic keyword rules applied
 * globally). Recompute services/groups from each tool's stored tool names. Idempotent; rewrites
 * only on change. */
export function reclassifyExistingTools(): void {
  if (!existsSync(toolsDataDir())) return;
  for (const fname of readdirSync(toolsDataDir())) {
    if (!fname.endsWith('.json')) continue;
    let tool: ToolDefinition;
    try {
      tool = loadTool(fname.slice(0, -'.json'.length));
    } catch {
      continue;
    }
    const perms = (tool.tool_permissions ?? {}) as Record<string, unknown>;
    if (!perms._services) continue;
    const names = Object.keys(perms).filter((k) => !k.startsWith('_'));
    if (names.length === 0) continue;
    const { services, serviceGroups, allRead, allWrite } = classifyServices(names, tool.name);
    if (JSON.stringify(perms._services) === JSON.stringify(services) && JSON.stringify(perms._service_groups) === JSON.stringify(serviceGroups)) continue;
    perms._services = services;
    perms._service_groups = serviceGroups;
    perms._categories = { read: allRead, write: allWrite };
    tool.tool_permissions = perms;
    try {
      saveTool(tool);
    } catch {
      // best-effort, matches the Python original's except Exception: pass.
    }
  }
}

/** One-time boot sequence mirroring tools_lib_lifespan: ensure DATA_DIR exists, seed default
 * permissions, reclassify pre-integration-scoped tools. */
export function initToolsLib(): void {
  mkdirSync(toolsDataDir(), { recursive: true });
  ensureDefaultPermissions();
  reclassifyExistingTools();
}

/** Where a tool's permission policy is stored.
 *
 * store === 'builtin': policy lives in builtin_permissions under `key`.
 * store === 'mcp':      policy lives on the owning tool's tool_permissions[action]; `key` is that
 *                       tool's id, or null when no such tool exists. */
export interface PolicySlot {
  store: 'builtin' | 'mcp';
  key: string | null;
  action: string | null;
}

const MCP_TOOL_NAME_RE = /^mcp__([^_]+(?:-[^_]+)*)__(.+)$/;

/** Single source of truth for WHERE a tool's permission policy is stored, so the dispatch gate
 * (read) and the 'Always approve' writer (write) can never key it differently. */
export function resolvePolicySlot(toolName: string, tools: readonly ToolDefinition[]): PolicySlot {
  const browserAgentMatch = /^mcp__maestro-browser-agent__(.+)$/.exec(toolName);
  if (browserAgentMatch) return { store: 'builtin', key: browserAgentMatch[1], action: null };
  const invokeAgentMatch = /^mcp__maestro-invoke-agent__(.+)$/.exec(toolName);
  if (invokeAgentMatch) return { store: 'builtin', key: invokeAgentMatch[1], action: null };
  const m = MCP_TOOL_NAME_RE.exec(toolName);
  if (m) {
    const [, serverSlug, action] = m;
    for (const t of tools) {
      if (t.mcp_config && Object.keys(t.mcp_config).length > 0 && t.enabled && sanitizeServerName(t.name) === serverSlug) {
        return { store: 'mcp', key: t.id, action };
      }
    }
    return { store: 'mcp', key: null, action };
  }
  return { store: 'builtin', key: toolName, action: null };
}

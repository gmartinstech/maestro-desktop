// engine/src/apps/outputs/workspaceIo.ts -- SUB-5, a full port of backend/apps/outputs/
// workspace_io.py: on-disk persistence for Output JSON records plus the workspace file-tree walk
// used by the polling read endpoint.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { atomicWriteJson } from '../../settings/store';
import { hydrateOutput, outputToStoredJson, type Output } from './models';
import { outputsDir, outputsWorkspaceDir } from './paths';

function readJsonOrNull(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function loadAll(env: NodeJS.ProcessEnv = process.env): Output[] {
  const dir = outputsDir(env);
  if (!existsSync(dir)) return [];
  const result: Output[] = [];
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const data = readJsonOrNull(join(dir, fname));
    if (data === null) continue;
    try {
      result.push(hydrateOutput(data));
    } catch {
      // Skip an unreadable/malformed output file rather than take down the whole listing --
      // mirrors workspace_io.py's own try/except-and-log.
    }
  }
  return result;
}

export function save(output: Output, env: NodeJS.ProcessEnv = process.env): void {
  atomicWriteJson(join(outputsDir(env), `${output.id}.json`), outputToStoredJson(output));
}

/** Load an Output by id, or null when it doesn't exist -- callers needing the Python route's
 * 404-on-missing HTTP behavior check for null themselves (outputs.ts's own handler), matching
 * dashboards/store.ts's `load()` convention. */
export function load(outputId: string, env: NodeJS.ProcessEnv = process.env): Output | null {
  const data = readJsonOrNull(join(outputsDir(env), `${outputId}.json`));
  return data === null ? null : hydrateOutput(data);
}

/** Public helper for other modules to resolve an output by ID -- same as load() here (the
 * Python original's loadOutput/load split exists because load() throws an HTTPException and
 * load_output doesn't; this port's load() already returns null instead of throwing, so the two
 * collapse into one function, kept as a named alias for call-site parity with outputs.py). */
export const loadOutput = load;

/** Resolve an App (Output) id to its on-disk workspace folder, or null if the app or its folder
 * is gone. */
export function appWorkspaceDir(outputId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const output = loadOutput(outputId, env);
  if (!output?.workspace_id) return null;
  const path = join(outputsWorkspaceDir(env), output.workspace_id);
  try {
    return statSync(path).isDirectory() ? path : null;
  } catch {
    return null;
  }
}

// Build/install/cache directories the polling endpoint must never descend into (see
// workspace_io.py's WALK_SKIP_DIRS for the full rationale: node_modules/.venv/__pycache__/etc would
// otherwise get re-serialized every 2s while the agent is active).
export const WALK_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.vite', '.vite-cache', '.vite_cache', '.git', 'dist', '.next',
  '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.maestro', '.openswarm',
]);

export const WALK_SKIP_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db']);

// Poll-payload guard, NOT an editor limit -- see workspace_io.py's own comment: 2MB clears real
// hand-authored apps but traps minified bundles/sourcemaps, reported via the `truncated` map
// instead of stubbed (a placeholder must never round-trip back into storage).
export const P_WALK_MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface WalkResult {
  files: Record<string, string>;
  truncated: Record<string, number>;
}

/** Walk a directory tree and return {files, truncated}. Oversize files are OMITTED from `files`
 * (never stubbed) and reported in `truncated` instead, so no consumer can mistake a placeholder
 * for real content. */
export function walkDirectory(folder: string): WalkResult {
  const files: Record<string, string> = {};
  const truncated: Record<string, number> = {};
  let rootStat;
  try {
    rootStat = statSync(folder);
  } catch {
    return { files, truncated };
  }
  if (!rootStat.isDirectory()) return { files, truncated };

  const stack: string[] = [folder];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (WALK_SKIP_FILES.has(entry.name)) continue;
      // Normalize to forward-slash keys so the frontend's path parsing behaves the same on
      // Windows (path.sep === '\\') as on macOS/Linux -- mirrors workspace_io.py's os.sep swap.
      const rel = relative(folder, full).split(sep).join('/');
      try {
        const size = statSync(full).size;
        if (size > P_WALK_MAX_FILE_BYTES) {
          truncated[rel] = size;
          continue;
        }
        files[rel] = readFileSync(full, 'utf8');
      } catch {
        // Best-effort, matches workspace_io.py's bare except-pass per file.
      }
    }
  }
  return { files, truncated };
}

/** True when this write would replace a known-oversize file (already past the poll cap) with a
 * smaller payload -- a smaller write is a truncation marker, not a real edit, so refusing it makes
 * export/snapshot corruption impossible at the disk boundary. */
export function wouldShrinkOversizeFile(fullPath: string, incoming: string): boolean {
  let existing: number;
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) return false;
    existing = st.size;
  } catch {
    return false;
  }
  return existing > P_WALK_MAX_FILE_BYTES && Buffer.byteLength(incoming, 'utf8') < existing;
}

export function ensureOutputsDirs(env: NodeJS.ProcessEnv = process.env): void {
  mkdirSync(outputsDir(env), { recursive: true });
  mkdirSync(outputsWorkspaceDir(env), { recursive: true });
}

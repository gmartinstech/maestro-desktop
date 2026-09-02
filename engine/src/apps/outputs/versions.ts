// engine/src/apps/outputs/versions.ts -- SUB-5, a full TypeScript port of backend/apps/outputs/
// versions.py: per-app version history, stored the way git stores history: content-addressed.
//
// Each unique file's bytes are written ONCE to a per-app blob store (sha256 name, zlib-compressed);
// a version is a tiny manifest mapping path -> blob digest. So a run that changes one file out of
// fifty costs one new blob, not fifty. Reuses AppExportable (SUB-5's own real port, see that
// file's header) as the serializer -- captures both flat-inline AND webapp_template workspace
// apps, skips node_modules/.venv/dist/.git, excludes .env -- but never AppExportable/ziputil's
// secret-shaped-field refusal path: a local snapshot must never decline to save the user's own
// app. No git binary: it isn't guaranteed on a packaged Mac/Win host.

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve as pathResolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppExportable } from '../swarm/entities/appExportable';
import type { ExportContext } from '../swarm/exportable';
import { RemapTable } from '../swarm/exportable';
import { hydrateOutputVersion, type Output, type OutputVersion } from './models';
import { WALK_SKIP_DIRS, loadOutput, save } from './workspaceIo';
import { outputsVersionsDir, outputsWorkspaceDir } from './paths';

const P_MAX_FILE_BYTES = 25 * 1024 * 1024; // don't snapshot giant build artifacts

// serialize() wants an ExportContext but apps have no cross-refs to rewrite.
const P_NULL_CTX: ExportContext = { bundleIdFor: () => null };

function pAppDir(outputId: string, env: NodeJS.ProcessEnv): string {
  return join(outputsVersionsDir(env), outputId);
}

function blobsDir(outputId: string, env: NodeJS.ProcessEnv): string {
  return join(pAppDir(outputId, env), 'blobs');
}

function pManifestsDir(outputId: string, env: NodeJS.ProcessEnv): string {
  return join(pAppDir(outputId, env), 'manifests');
}

function pDigest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function pSafeJoin(folder: string, rel: string): string {
  const dest = pathResolve(join(folder, rel));
  const root = pathResolve(folder);
  if (dest !== root && !dest.startsWith(root + sep)) throw new Error('version file path escapes the workspace');
  return dest;
}

function pWriteBlob(outputId: string, data: Buffer, digest: string, env: NodeJS.ProcessEnv): void {
  const dir = blobsDir(outputId, env);
  const path = join(dir, digest);
  if (existsSync(path)) return; // already stored: a file unchanged since an earlier version
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, deflateSync(data));
  renameSync(tmp, path);
}

function pReadBlob(outputId: string, digest: string, env: NodeJS.ProcessEnv): Buffer | null {
  try {
    return inflateSync(readFileSync(join(blobsDir(outputId, env), digest)));
  } catch {
    return null;
  }
}

interface Manifest {
  id: string;
  created_at: string;
  label: string;
  source: string;
  parent_id: string | null;
  thumbnail: string | null;
  tree_hash: string;
  app_meta: Record<string, unknown>;
  files: Record<string, string>; // rel path -> blob digest
}

export function readManifest(outputId: string, versionId: string, env: NodeJS.ProcessEnv = process.env): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(pManifestsDir(outputId, env), `${versionId}.json`), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Newest manifest by write time; only read for the dedupe check so capture stays O(1) reads
 * rather than scanning every version's content. */
function pLatestManifest(outputId: string, env: NodeJS.ProcessEnv): Manifest | null {
  const dir = pManifestsDir(outputId, env);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return null;
  let newest = jsonFiles[0];
  let newestMtime = statSync(join(dir, newest)).mtimeMs;
  for (const f of jsonFiles.slice(1)) {
    const mtime = statSync(join(dir, f)).mtimeMs;
    if (mtime > newestMtime) {
      newest = f;
      newestMtime = mtime;
    }
  }
  try {
    return JSON.parse(readFileSync(join(dir, newest), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Deterministic, recursively key-sorted JSON -- mirrors Python's `json.dumps(obj, sort_keys=True)`
 * (which sorts nested dict keys too, not just the top level). */
function pStableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pStableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${pStableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Dedupe key over the snapshot's content: app metadata + path->digest map. Cheap because the
 * per-file hashing already happened to name the blobs. */
function pTreeHash(appMeta: Record<string, unknown>, fileMap: Record<string, string>): string {
  const h = createHash('sha256');
  h.update(pStableJson(appMeta));
  h.update('\0');
  for (const path of Object.keys(fileMap).sort()) {
    h.update(path);
    h.update('\0');
    h.update(fileMap[path]);
    h.update('\0');
  }
  return h.digest('hex');
}

function pSnapshot(output: Output): { appMeta: Record<string, unknown>; files: Record<string, Buffer> } {
  const app = new AppExportable(output);
  return { appMeta: app.serialize(P_NULL_CTX) as Record<string, unknown>, files: app.files() };
}

export function listVersions(outputId: string, env: NodeJS.ProcessEnv = process.env): OutputVersion[] {
  const dir = pManifestsDir(outputId, env);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: OutputVersion[] = [];
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const m = readManifest(outputId, fname.slice(0, -'.json'.length), env);
    if (m === null) continue;
    try {
      out.push(hydrateOutputVersion(m as unknown as Record<string, unknown>));
    } catch {
      // Skip an unreadable manifest rather than fail the whole list.
    }
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return out;
}

export interface CaptureOptions {
  source?: 'auto' | 'manual' | 'pre_restore';
  label?: string;
  thumbnail?: string | null;
}

/** Snapshot current app state. Returns the existing latest version (no new manifest) when nothing
 * changed, so unchanged runs don't pile up. null only if the app is gone. */
export function capture(outputId: string, opts: CaptureOptions = {}, env: NodeJS.ProcessEnv = process.env): OutputVersion | null {
  const output = loadOutput(outputId, env);
  if (output === null) return null;
  const { appMeta, files } = pSnapshot(output);

  const fileMap: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    if (data.length > P_MAX_FILE_BYTES) continue;
    fileMap[path] = pDigest(data);
  }
  const tree = pTreeHash(appMeta, fileMap);

  const latest = pLatestManifest(outputId, env);
  const parentId = latest?.id ?? null;
  if (latest !== null && latest.tree_hash === tree) {
    try {
      return hydrateOutputVersion(latest as unknown as Record<string, unknown>);
    } catch {
      // Corrupt latest: fall through and write a fresh manifest.
    }
  }

  for (const [path, data] of Object.entries(files)) {
    const digest = fileMap[path];
    if (digest !== undefined) pWriteBlob(outputId, data, digest, env);
  }

  const vid = randomUUID().replace(/-/g, '');
  const manifest: Manifest = {
    id: vid,
    created_at: new Date().toISOString(),
    label: opts.label ?? '',
    source: opts.source ?? 'auto',
    parent_id: parentId,
    // Python's own check is `thumbnail is not None` (not "was the kwarg passed"), so an explicit
    // null here falls through to output.thumbnail exactly like an omitted one would.
    thumbnail: opts.thumbnail !== undefined && opts.thumbnail !== null ? opts.thumbnail : output.thumbnail,
    tree_hash: tree,
    app_meta: appMeta,
    files: fileMap,
  };
  const dir = pManifestsDir(outputId, env);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${vid}.json`);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest));
  renameSync(tmp, dest);
  return hydrateOutputVersion(manifest as unknown as Record<string, unknown>);
}

/** Make the workspace match the snapshot. Deletes current authored files not in it, then writes
 * the rest FROM BLOBS, skipping any file already byte-correct (so a restore writes only the
 * diff). Keeps the live .env and build/cache dirs. Per-file writes: a crash mid-restore leaves a
 * mixed tree, but the pre_restore backup restore() takes first is the real safety net. */
function pRestoreWorkspace(outputId: string, workspaceId: string, fileMap: Record<string, string>, env: NodeJS.ProcessEnv): void {
  const folder = join(outputsWorkspaceDir(env), workspaceId);
  mkdirSync(folder, { recursive: true });
  const targets: Record<string, string> = {};
  for (const [key, digest] of Object.entries(fileMap)) {
    if (key.startsWith('workspace/')) targets[key.slice('workspace/'.length)] = digest;
  }

  const walkPrune = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue;
        walkPrune(full);
        continue;
      }
      if (entry.name === '.env') continue;
      const rel = relative(folder, full).split(sep).join('/');
      if (!(rel in targets)) {
        try {
          unlinkSync(full);
        } catch {
          // Best-effort.
        }
      }
    }
  };
  walkPrune(folder);

  for (const [rel, digest] of Object.entries(targets)) {
    const dest = pSafeJoin(folder, rel);
    if (existsSync(dest)) {
      try {
        if (pDigest(readFileSync(dest)) === digest) continue; // already correct
      } catch {
        // Fall through to (re)write.
      }
    }
    const data = pReadBlob(outputId, digest, env);
    if (data === null) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
}

/** Bring the app back to an earlier version, in place. Saves the current state as a pre_restore
 * version first so this is always undoable. */
export function restore(outputId: string, versionId: string, env: NodeJS.ProcessEnv = process.env): Output | null {
  const output = loadOutput(outputId, env);
  if (output === null) return null;
  const manifest = readManifest(outputId, versionId, env);
  if (manifest === null) return null;

  const targetLabel = manifest.label || 'an earlier version';
  capture(outputId, { source: 'pre_restore', label: `Before restoring '${targetLabel}'` }, env);

  const appMeta = manifest.app_meta ?? {};
  output.name = (appMeta.name as string) ?? output.name;
  output.description = (appMeta.description as string) ?? output.description;
  output.icon = (appMeta.icon as string) ?? output.icon;
  // Presence, not truthiness: a snapshot's empty {} schema must restore as empty.
  if (appMeta.input_schema !== undefined && appMeta.input_schema !== null) {
    output.input_schema = appMeta.input_schema as Output['input_schema'];
  }
  output.files = (appMeta.files as Record<string, string>) ?? {};
  if (manifest.thumbnail !== undefined && manifest.thumbnail !== null) output.thumbnail = manifest.thumbnail;
  const now = new Date().toISOString();
  output.updated_at = now;
  output.preview_updated_at = now;

  if (output.workspace_id) pRestoreWorkspace(outputId, output.workspace_id, manifest.files ?? {}, env);
  save(output, env);
  return output;
}

/** Make a brand-new app from an earlier version. Reuses AppExportable.import_, which mints a
 * fresh output id + workspace id and localizes a fresh .env. */
export function branch(outputId: string, versionId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const manifest = readManifest(outputId, versionId, env);
  if (manifest === null) return null;
  const appMeta: Record<string, unknown> = { ...(manifest.app_meta ?? {}) };
  appMeta.name = `${(appMeta.name as string) || 'App'} (copy)`;
  const files: Record<string, Buffer> = {};
  for (const [path, digest] of Object.entries(manifest.files ?? {})) {
    const data = pReadBlob(outputId, digest, env);
    if (data !== null) files[path] = data;
  }
  try {
    return AppExportable.import_(appMeta, files, new RemapTable());
  } catch (err) {
    // A partial import leaves an orphan workspace dir (small); better than a 500.
    console.error(`[outputs] branch import failed for ${outputId}/${versionId}:`, err);
    return null;
  }
}

export function deleteAll(outputId: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    rmSync(pAppDir(outputId, env), { recursive: true, force: true });
  } catch {
    // Best-effort, matches versions.py's own ignore_errors=True.
  }
}

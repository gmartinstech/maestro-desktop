// engine/src/apps/swarm/ziputil.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/ziputil.py.
//
// Hardened zip <-> bytes for .swarm bundles. The zip arrives from an untrusted party, so unpack()
// defends against zip-slip, zip-bombs, symlinks, and lying size headers, and only ever writes into
// a throwaway sandbox dir (never a real store). pack() re-checks that no secret slipped past
// redaction before writing a byte.
//
// Uses jszip (added as an engine dependency by this ticket) for the actual DEFLATE container
// encode/decode -- Node has no zip-format support built in, only the raw compression primitives.
// jszip's `loadAsync` only parses zip *metadata* (central directory), it does not eagerly inflate
// any entry -- so the size/ratio/symlink pre-checks below run before a single byte of untrusted
// data is decompressed, mirroring Python's `zipfile.ZipFile(...).infolist()` pass. The actual
// per-entry read then goes through `nodeStream()` (a real Node stream), counted chunk-by-chunk and
// aborted the instant it would exceed MAX_FILE_BYTES/MAX_TOTAL_BYTES -- this is what makes the
// defense hold even against an entry whose header LIES about its uncompressed size (DEFLATE's
// worst-case expansion ratio is bounded, but a header is just an integer an attacker fully
// controls); Python's own chunked `src.read(65536)` loop is doing the exact same thing.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import { findDeniedKeys, findSecretsInFiles } from './redact';

export const MANIFEST_NAME = 'manifest.json';

export const MAX_ENTRIES = 5000;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB uncompressed
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per entry
export const MAX_RATIO = 200; // uncompressed / compressed per entry

/** Bundle is malformed or unsafe. Message is safe to show the user. */
export class BundleError extends Error {}

/** Order-independent sha256 over every non-manifest entry (path + bytes). */
function contentDigest(entries: Record<string, Buffer>): string {
  const h = createHash('sha256');
  for (const path of Object.keys(entries).sort()) {
    h.update(path, 'utf8');
    h.update(Buffer.from([0]));
    h.update(entries[path]);
    h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

/** payloads: bundle_id -> JSON payload (-> entities/<bid>/payload.json).
 * files: full zip path -> bytes (e.g. entities/<bid>/files/<rel>). */
export async function pack(
  manifest: Record<string, unknown>,
  payloads: Record<string, Record<string, unknown>>,
  files: Record<string, Buffer>,
): Promise<Buffer> {
  for (const [bid, payload] of Object.entries(payloads)) {
    const leaked = findDeniedKeys(payload);
    if (leaked.length > 0) {
      throw new BundleError(`refusing to export: secret-shaped field(s) in ${bid}: ${JSON.stringify(leaked.slice(0, 3))}`);
    }
  }
  const leakyFiles = findSecretsInFiles(files);
  if (leakyFiles.length > 0) {
    throw new BundleError(
      `refusing to export: a secret-shaped value is in ${leakyFiles[0]}; remove it (use an environment variable) and try again`,
    );
  }
  const entries: Record<string, Buffer> = {};
  for (const [bid, payload] of Object.entries(payloads)) {
    entries[`entities/${bid}/payload.json`] = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  }
  for (const [path, data] of Object.entries(files)) {
    entries[path] = data;
  }
  const finalManifest = { ...manifest, checksum: contentDigest(entries) };

  const zip = new JSZip();
  zip.file(MANIFEST_NAME, JSON.stringify(finalManifest, null, 2));
  for (const path of Object.keys(entries).sort()) {
    zip.file(path, entries[path]);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Every file under the sandbox except the manifest, keyed by forward-slash relpath so it matches
 * the keys pack() hashed (cross-platform). */
function sandboxEntries(sandbox: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  const root = resolve(sandbox);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const rel = full.slice(root.length + 1).split(sep).join('/');
      if (rel === MANIFEST_NAME) continue;
      out[rel] = readFileSync(full);
    }
  };
  walk(root);
  return out;
}

/** Rejects an archive whose contents don't match the checksum the author recorded (corruption or
 * tampering). Older bundles without one are allowed. */
export function verifyChecksum(sandbox: string, manifest: Record<string, unknown>): void {
  const expected = manifest.checksum;
  if (!expected) return;
  if (contentDigest(sandboxEntries(sandbox)) !== expected) {
    throw new BundleError('this .swarm looks corrupted or was modified');
  }
}

function safeMemberPath(name: string, sandbox: string): string {
  if (name.startsWith('/') || name.startsWith('\\') || (name.length > 1 && name[1] === ':')) {
    throw new BundleError('bundle contains an absolute path');
  }
  const dest = resolve(join(sandbox, name));
  const root = resolve(sandbox);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new BundleError('bundle contains a path-traversal entry');
  }
  return dest;
}

export async function isZip(raw: Buffer): Promise<boolean> {
  try {
    await JSZip.loadAsync(raw);
    return true;
  } catch {
    return false;
  }
}

export async function hasMember(raw: Buffer, name: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(raw);
  return Boolean(zip.file(name));
}

// Internal, undocumented-but-stable jszip shape: ZipObject._data is the CompressedObject the
// central-directory parse populated (compressedSize/uncompressedSize straight off the zip
// headers, BEFORE any inflate runs) -- see this file's header for why that ordering matters. Cast
// through `unknown` rather than trusting jszip's public .d.ts (which doesn't expose it), and treat
// a missing/malformed shape as "unknown size", which the caller below fails safe on (rejects
// rather than silently skips the cap).
function headerSizes(fileObj: JSZip.JSZipObject): { compressed: number; uncompressed: number } | null {
  const data = (fileObj as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data;
  if (!data || typeof data.compressedSize !== 'number' || typeof data.uncompressedSize !== 'number') return null;
  return { compressed: data.compressedSize, uncompressed: data.uncompressedSize };
}

function isSymlink(fileObj: JSZip.JSZipObject): boolean {
  const perms = fileObj.unixPermissions;
  const mode = typeof perms === 'string' ? parseInt(perms, 8) : perms;
  if (!mode) return false;
  return (mode & 0o170000) === 0o120000;
}

/** Reads one entry's real bytes via a streamed, chunk-counted read that aborts the instant the
 * running total would exceed maxBytes -- see this file's header on why this (not the header's
 * claimed size) is the actual bomb defense. */
function readEntryCapped(fileObj: JSZip.JSZipObject, maxBytes: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const stream = fileObj.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy?: () => void };
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    stream.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new BundleError('bundle exceeded size during extraction'));
        stream.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (err: unknown) => {
      if (!aborted) reject(err instanceof Error ? err : new Error(String(err)));
    });
    stream.on('end', () => {
      if (!aborted) resolvePromise(Buffer.concat(chunks));
    });
  });
}

/** Extract into a fresh sandbox temp dir and return it. Caller deletes it. */
export async function unpack(raw: Buffer): Promise<string> {
  if (raw.length > MAX_TOTAL_BYTES) {
    throw new BundleError('bundle is too large');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(raw);
  } catch {
    throw new BundleError('not a valid .swarm file');
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > MAX_ENTRIES) {
    throw new BundleError('bundle has too many entries');
  }
  let total = 0;
  for (const entry of entries) {
    const sizes = headerSizes(entry);
    // Unknown header sizes fail safe: treated as exceeding every cap below (never silently
    // trusted as zero/small).
    const uncompressed = sizes?.uncompressed ?? MAX_TOTAL_BYTES + 1;
    const compressed = sizes?.compressed ?? 0;
    if (uncompressed > MAX_FILE_BYTES) {
      throw new BundleError('bundle has an oversized entry');
    }
    total += uncompressed;
    if (total > MAX_TOTAL_BYTES) {
      throw new BundleError('bundle is too large uncompressed');
    }
    if (compressed > 0 && uncompressed / compressed > MAX_RATIO) {
      throw new BundleError('bundle entry is suspiciously compressed');
    }
    if (isSymlink(entry)) {
      throw new BundleError('bundle contains a symlink');
    }
  }

  const sandbox = mkdtempSync(join(tmpdir(), 'swarm-import-'));
  try {
    let written = 0;
    for (const entry of entries) {
      const dest = safeMemberPath(entry.name, sandbox);
      mkdirSync(dirname(dest), { recursive: true });
      const data = await readEntryCapped(entry, MAX_FILE_BYTES);
      written += data.length;
      if (written > MAX_TOTAL_BYTES) {
        throw new BundleError('bundle exceeded size during extraction');
      }
      writeFileSync(dest, data);
    }
  } catch (e) {
    rmSync(sandbox, { recursive: true, force: true });
    throw e;
  }
  return sandbox;
}

export function readManifest(sandbox: string): Record<string, unknown> {
  const path = join(sandbox, MANIFEST_NAME);
  if (!existsSync(path)) {
    throw new BundleError('bundle has no manifest');
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new BundleError('bundle manifest is unreadable');
  }
}

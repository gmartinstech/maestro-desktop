// engine/src/settings/uploads.ts -- SUB-10, a TypeScript port of backend/apps/settings/settings.py's
// file-attachment surface: sniff_file_kind, estimate_pdf_tokens, POST /upload-files, and
// GET /browse-directories. Kept in its own module (not handler.ts) because it needs node:fs/
// node:os/node:path, none of which the bare-settings GET/PUT/PATCH path touches.
//
// Multipart parsing: server.ts's Fastify instance disables ALL content-type parsers (a proxy must
// forward exact bytes -- see server.ts's own header), so unlike a normal Fastify app there is no
// @fastify/multipart plugin already attached. apps/swarm/swarm.ts already hand-rolled a minimal
// parser for its own single-file shape; parseMultipartFiles() below is the same technique
// generalized to the shape THIS route's frontend caller actually sends
// (frontend/src/app/pages/AgentChat/ChatInput/hooks/useContextFiles.ts:
// `files.forEach((f) => formData.append('files', f))` -- one repeated `files` field, one or more
// parts) -- still not a general multipart/form-data implementation, just this one shape.

import { existsSync, mkdirSync, openSync, closeSync, writeSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path';

// backend/apps/settings/settings.py's UPLOAD_DIR -- same OS temp-dir root Python uses
// (tempfile.gettempdir() and node:os's tmpdir() both resolve to the same OS-level temp directory),
// so a file an already-running Python backend saved is still readable by this engine and vice
// versa during the migration window.
export const UPLOAD_DIR = join(tmpdir(), 'maestro-uploads');

function ensureUploadDir(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export interface ParsedMultipartFile {
  filename: string;
  data: Buffer;
}

/** Extracts every part named `fieldName` from a multipart/form-data body -- unlike
 * apps/swarm/swarm.ts's parseMultipartFile (exactly one `file` part), this route's caller can send
 * many `files` parts in one request. Returns [] on anything that doesn't parse (missing boundary,
 * no matching part) -- caller treats that as "no files uploaded", matching FastAPI's own
 * `files: list[UploadFile] = File(...)` behavior on a missing/malformed body. */
export function parseMultipartFiles(contentType: string, body: Buffer, fieldName = 'files'): ParsedMultipartFile[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m ? (m[1] ?? m[2]).trim() : null;
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = body.indexOf(delimiter, searchFrom);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length, next));
    searchFrom = next;
  }
  const out: ParsedMultipartFile[] = [];
  for (const part of parts) {
    // Each part is `\r\n<headers>\r\n\r\n<body>\r\n` (leading \r\n after the boundary marker, one
    // trailing \r\n before the next boundary marker) -- strip both before inspecting.
    let p = part;
    if (p.subarray(0, 2).toString('latin1') === '\r\n') p = p.subarray(2);
    if (p.subarray(-2).toString('latin1') === '\r\n') p = p.subarray(0, p.length - 2);
    const headerEnd = p.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = p.subarray(0, headerEnd).toString('latin1');
    const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText);
    if (!dispositionMatch) continue;
    const params = dispositionMatch[1];
    const nameMatch = /name="([^"]*)"/.exec(params);
    if (!nameMatch || nameMatch[1] !== fieldName) continue;
    const filenameMatch = /filename="([^"]*)"/.exec(params);
    const data = p.subarray(headerEnd + 4);
    out.push({ filename: filenameMatch ? filenameMatch[1] : '', data });
  }
  return out;
}

export type SniffedKind = 'text' | 'pdf' | 'image' | 'binary';

/** Classify an uploaded file as text/pdf/image/binary so the agent layer can route it (inline as
 * text, send as a native document/image block, or refuse). Mirrors settings.py's sniff_file_kind
 * signature byte match -- every magic-number check copied verbatim. */
export function sniffFileKind(contents: Buffer): { kind: SniffedKind; mediaType: string | null } {
  const head = contents.subarray(0, 4096);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mediaType: 'application/pdf' };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mediaType: 'image/png' };
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { kind: 'image', mediaType: 'image/jpeg' };
  const s6 = head.subarray(0, 6).toString('latin1');
  if (s6 === 'GIF87a' || s6 === 'GIF89a') return { kind: 'image', mediaType: 'image/gif' };
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mediaType: 'image/webp' };
  // Other common binary signatures that don't contain a null byte in the first few bytes: zip/docx/
  // xlsx/pptx/jar/apk/odt (PK\x03\x04), gzip (\x1f\x8b), 7z, tar, rar, ELF, Mach-O, Win exe (MZ),
  // Java class, sqlite -- same list settings.py's sniff_file_kind checks.
  const binarySignatures: Buffer[] = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x1f, 0x8b]), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    Buffer.from('Rar!\x1a\x07', 'latin1'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from([0xfe, 0xed, 0xfa, 0xce]), Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    Buffer.from('MZ', 'latin1'), Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    Buffer.from('SQLite format 3\x00', 'latin1'),
  ];
  if (binarySignatures.some((sig) => head.subarray(0, sig.length).equals(sig))) return { kind: 'binary', mediaType: null };
  // Binary heuristic: any null bytes in the first 4KB is a strong "not text" signal.
  if (head.includes(0x00)) return { kind: 'binary', mediaType: null };
  try {
    // Node's toString('utf8') never throws on invalid bytes (unlike Python's strict .decode()) --
    // it silently substitutes U+FFFD -- so validity is checked by re-encoding and comparing byte
    // length, which is exactly what a lossy substitution changes.
    const decoded = head.toString('utf8');
    if (Buffer.byteLength(decoded, 'utf8') === head.length) return { kind: 'text', mediaType: 'text/plain' };
    return { kind: 'binary', mediaType: null };
  } catch {
    return { kind: 'binary', mediaType: null };
  }
}

/** Conservative PDF token estimate without a parser dependency -- port of settings.py's
 * estimate_pdf_tokens, same two-signal max() strategy (page count from the PDF catalog, else a
 * byte-size heuristic) so the chip + dry-run guard never under-report. */
export function estimatePdfTokens(contents: Buffer): number {
  let byPages = 0;
  try {
    const text = contents.toString('latin1');
    let match = /\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/.exec(text);
    if (!match) match = /\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(text);
    if (match) {
      const pages = parseInt(match[1], 10);
      if (pages > 0 && pages < 10_000) byPages = pages * 750;
    }
  } catch {
    // best-effort, matches estimate_pdf_tokens' own broad except
  }
  const byBytes = Math.max(1_000, Math.min(Math.floor(contents.length / 80), 2_000_000));
  return Math.max(byPages, byBytes);
}

export interface UploadedFileResult {
  path: string;
  name: string;
  size: number;
  tokens: number;
  kind: SniffedKind;
  media_type: string | null;
}

/** Save one uploaded file under UPLOAD_DIR with an O_EXCL create-with-collision-retry (so two
 * concurrent uploads of the same filename never overwrite each other -- the second retries under
 * `<base>_<n><ext>`), sniff its kind, and estimate its token cost. Mirrors settings.py's
 * upload_files loop body for exactly one file. */
export function saveUploadedFile(originalName: string, contents: Buffer): UploadedFileResult {
  ensureUploadDir();
  let safeName = basename(originalName || 'untitled').replace(/\\/g, '_').replace(/\//g, '_') || 'untitled';
  const dotIndex = safeName.lastIndexOf('.');
  const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : '';
  let dest = join(UPLOAD_DIR, safeName);
  let counter = 0;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(dest, 'wx', 0o644);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      counter += 1;
      if (counter > 10_000) throw new Error('upload dedup exhausted');
      safeName = `${base}_${counter}${ext}`;
      dest = join(UPLOAD_DIR, safeName);
    }
  }
  try {
    writeSync(fd, contents);
  } finally {
    closeSync(fd);
  }

  const { kind, mediaType } = sniffFileKind(contents);
  let tokensEst: number;
  if (kind === 'text') {
    const capped = contents.subarray(0, 512_000);
    tokensEst = Math.max(0, Math.floor(capped.toString('utf8').length / 4));
  } else if (kind === 'pdf') {
    tokensEst = estimatePdfTokens(contents);
  } else if (kind === 'image') {
    tokensEst = 1_500;
  } else {
    tokensEst = 0;
  }

  return { path: dest, name: safeName, size: contents.length, tokens: tokensEst, kind, media_type: mediaType };
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  directories: string[];
  files: string[];
}

export type BrowseError = { status: number; detail: string };

function expandUser(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/** Port of settings.py's browse_directories: list a directory's immediate children, split into
 * directories/files, hiding dotfiles. Returns a BrowseError shape (never throws) for a missing
 * path, a non-directory path, or a permission failure -- same three failure modes the Python route
 * maps to 404/400/403. */
export function browseDirectories(rawPath: string): BrowseResult | BrowseError {
  const requested = rawPath.trim();
  let target = requested ? expandUser(requested) : homedir();
  target = resolvePath(target);

  if (!existsSync(target)) return { status: 404, detail: `Path not found: ${target}` };
  const stat = statSync(target);
  if (!stat.isDirectory()) return { status: 400, detail: `Not a directory: ${target}` };

  let entries: string[];
  try {
    entries = readdirSync(target).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM') {
      return { status: 403, detail: `Permission denied: ${target}` };
    }
    throw e;
  }

  const visible = entries.filter((e) => !e.startsWith('.'));
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of visible) {
    try {
      if (statSync(join(target, entry)).isDirectory()) directories.push(entry);
      else files.push(entry);
    } catch {
      // A vanished/unreadable entry (deleted mid-listing, a broken symlink) is skipped rather than
      // failing the whole listing -- matches Python's own os.path.isdir/isfile silently returning
      // False on a stat error, so an inaccessible entry there is simply invisible, same outcome.
    }
  }

  const parent = target === dirname(target) ? null : dirname(target);
  return { current: target, parent, directories, files };
}

/** Best-effort read of the (path, contents) pair a summarize-file call needs -- centralizes the
 * "must live under UPLOAD_DIR" containment check settings.py's summarize_file enforces via
 * os.path.commonpath, so a caller can't walk this route outside the upload sandbox. */
export function readUploadedFileForSummary(path: string): { ok: true; contents: string } | { ok: false; status: number; detail: string } {
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, status: 404, detail: 'file not found' };
  const real = resolvePath(path);
  const realRoot = resolvePath(UPLOAD_DIR);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return { ok: false, status: 400, detail: 'path outside upload dir' };
  }
  try {
    const raw = readFileSync(path, 'utf8').slice(0, 2_000_000);
    return { ok: true, contents: raw };
  } catch (e) {
    return { ok: false, status: 500, detail: `read failed: ${(e as Error).message}` };
  }
}

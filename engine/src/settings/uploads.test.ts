import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { browseDirectories, estimatePdfTokens, parseMultipartFiles, readUploadedFileForSummary, saveUploadedFile, sniffFileKind, UPLOAD_DIR } from './uploads';

const createdPaths: string[] = [];
afterEach(() => {
  for (const p of createdPaths.splice(0)) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
});

describe('sniffFileKind', () => {
  test('pdf magic number', () => {
    expect(sniffFileKind(Buffer.from('%PDF-1.7 rest of file')).kind).toBe('pdf');
  });
  test('png/jpeg/gif/webp magic numbers', () => {
    expect(sniffFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])).kind).toBe('image');
    expect(sniffFileKind(Buffer.from([0xff, 0xd8, 0xff, 0, 0])).kind).toBe('image');
    expect(sniffFileKind(Buffer.from('GIF89a....')).kind).toBe('image');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
    expect(sniffFileKind(webp).kind).toBe('image');
  });
  test('a null byte anywhere in the first 4KB reads as binary', () => {
    expect(sniffFileKind(Buffer.from([0x61, 0x62, 0x00, 0x63])).kind).toBe('binary');
  });
  test('zip/MZ/ELF signatures read as binary', () => {
    expect(sniffFileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])).kind).toBe('binary');
    expect(sniffFileKind(Buffer.from('MZ\x90\x00rest')).kind).toBe('binary');
    expect(sniffFileKind(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2])).kind).toBe('binary');
  });
  test('plain ASCII/UTF-8 text reads as text', () => {
    expect(sniffFileKind(Buffer.from('hello, world\nthis is plain text', 'utf8')).kind).toBe('text');
  });
});

describe('estimatePdfTokens', () => {
  test('uses the page count when the catalog declares one', () => {
    const contents = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 4 >>\nendobj\n');
    expect(estimatePdfTokens(contents)).toBe(4 * 750);
  });
  test('falls back to the byte-size heuristic when no page count is found, with a 1000-token floor', () => {
    expect(estimatePdfTokens(Buffer.from('%PDF-1.4 tiny'))).toBe(1_000);
  });
  test('takes the MAX of the two signals, not the page-count alone', () => {
    const bigJunk = Buffer.concat([Buffer.from('%PDF-1.4\n<< /Type /Pages /Count 1 >>\n'), Buffer.alloc(200_000, 0x41)]);
    expect(estimatePdfTokens(bigJunk)).toBeGreaterThan(750);
  });
});

describe('parseMultipartFiles', () => {
  test('extracts every part with a matching field name, ignoring others', () => {
    const boundary = 'B';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nignored\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\n\r\nAAA\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="b.txt"\r\n\r\nBBB\r\n` +
      `--${boundary}--\r\n`,
    );
    const parts = parseMultipartFiles(`multipart/form-data; boundary=${boundary}`, body, 'files');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ filename: 'a.txt', data: Buffer.from('AAA') });
    expect(parts[1]).toEqual({ filename: 'b.txt', data: Buffer.from('BBB') });
  });

  test('no boundary in the content-type -> empty array, not a throw', () => {
    expect(parseMultipartFiles('multipart/form-data', Buffer.from('anything'), 'files')).toEqual([]);
  });

  test('a quoted boundary is accepted too', () => {
    const body = Buffer.from('--Q\r\nContent-Disposition: form-data; name="files"; filename="x.txt"\r\n\r\nZZZ\r\n--Q--\r\n');
    const parts = parseMultipartFiles('multipart/form-data; boundary="Q"', body, 'files');
    expect(parts).toEqual([{ filename: 'x.txt', data: Buffer.from('ZZZ') }]);
  });
});

describe('saveUploadedFile', () => {
  test('sniffs kind, estimates text tokens, and strips path separators from the name', () => {
    const contents = Buffer.from('a'.repeat(40), 'utf8');
    const result = saveUploadedFile('..\\..\\evil/name.txt', contents);
    createdPaths.push(result.path);
    expect(result.name).not.toContain('/');
    expect(result.name).not.toContain('\\');
    expect(result.kind).toBe('text');
    expect(result.tokens).toBe(10);
    expect(readFileSync(result.path)).toEqual(contents);
  });

  test('a collision retries under `_1`, never overwriting the first file', () => {
    const tag = randomUUID().slice(0, 8);
    const name = `dup-${tag}.txt`;
    const first = saveUploadedFile(name, Buffer.from('first'));
    const second = saveUploadedFile(name, Buffer.from('second'));
    createdPaths.push(first.path, second.path);
    expect(first.path).not.toBe(second.path);
    expect(readFileSync(first.path, 'utf8')).toBe('first');
    expect(readFileSync(second.path, 'utf8')).toBe('second');
  });

  test('files really do land under UPLOAD_DIR', () => {
    const result = saveUploadedFile(`probe-${randomUUID().slice(0, 8)}.txt`, Buffer.from('x'));
    createdPaths.push(result.path);
    expect(result.path.startsWith(UPLOAD_DIR)).toBe(true);
  });
});

describe('browseDirectories', () => {
  let scratch: string;
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('lists directories and files separately, hiding dotfiles', () => {
    scratch = mkdtempSync(join(tmpdir(), 'maestro-browse-test-'));
    mkdirSync(join(scratch, 'subdir'));
    writeFileSync(join(scratch, 'visible.txt'), 'x');
    writeFileSync(join(scratch, '.hidden'), 'x');
    const result = browseDirectories(scratch);
    expect('status' in result).toBe(false);
    if (!('status' in result)) {
      expect(result.directories).toEqual(['subdir']);
      expect(result.files).toEqual(['visible.txt']);
      expect(result.parent).not.toBeNull();
    }
  });

  test('a missing path is a 404-shaped error', () => {
    const result = browseDirectories(join(tmpdir(), `definitely-missing-${randomUUID()}`));
    expect(result).toMatchObject({ status: 404 });
  });

  test('a file (not a directory) is a 400-shaped error', () => {
    scratch = mkdtempSync(join(tmpdir(), 'maestro-browse-test-'));
    const filePath = join(scratch, 'a-file.txt');
    writeFileSync(filePath, 'x');
    const result = browseDirectories(filePath);
    expect(result).toMatchObject({ status: 400 });
  });
});

describe('readUploadedFileForSummary', () => {
  test('a path outside UPLOAD_DIR is refused even if it exists', () => {
    const outside = mkdtempSync(join(tmpdir(), 'maestro-outside-upload-dir-'));
    const filePath = join(outside, 'x.txt');
    writeFileSync(filePath, 'hello');
    try {
      const result = readUploadedFileForSummary(filePath);
      expect(result).toMatchObject({ ok: false, status: 400 });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a missing path under UPLOAD_DIR is a 404', () => {
    const result = readUploadedFileForSummary(join(UPLOAD_DIR, `nope-${randomUUID()}.txt`));
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  test('a real file under UPLOAD_DIR reads back its contents', () => {
    const saved = saveUploadedFile(`summary-src-${randomUUID().slice(0, 8)}.txt`, Buffer.from('the real content'));
    createdPaths.push(saved.path);
    const result = readUploadedFileForSummary(saved.path);
    expect(result).toEqual({ ok: true, contents: 'the real content' });
  });
});

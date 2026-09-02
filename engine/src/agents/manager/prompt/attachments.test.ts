// engine/src/agents/manager/prompt/attachments.test.ts -- AGT-5. Fresh coverage for
// attachments.ts (no backend/tests/test_attachments.py exists to port -- this module has no
// dedicated Python test file; the GATE's search patterns name gate/path/system_prompt/context_
// budget/context_pressure/distill_history/compact, none of which land here). Exercises the branches
// most likely to silently regress: text inlining, the PDF native block + Anthropic cache_control
// tagging, a provider that can't take PDFs, and the not-found path.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDirTree, resolveAttachments, sniffFileKind } from './attachments';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'attachments-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sniffFileKind', () => {
  it('recognizes a PDF by magic bytes', () => {
    expect(sniffFileKind(Buffer.from('%PDF-1.4\n...'))[0]).toBe('pdf');
  });
  it('recognizes a PNG by magic bytes', () => {
    expect(sniffFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))[0]).toBe('image');
  });
  it('classifies plain UTF-8 as text', () => {
    expect(sniffFileKind(Buffer.from('hello world', 'utf-8'))[0]).toBe('text');
  });
  it('classifies a null-byte-containing buffer as binary', () => {
    expect(sniffFileKind(Buffer.from([0x41, 0x00, 0x42]))[0]).toBe('binary');
  });
});

describe('resolveAttachments', () => {
  it('inlines a small text file as a <context_file> block', () => {
    const p = join(dir, 'notes.txt');
    writeFileSync(p, 'hello from a test file');
    const [text, native, refusals] = resolveAttachments([{ path: p, type: 'file' }], 'anthropic', 'sonnet');
    expect(text).toContain('<context_file');
    expect(text).toContain('hello from a test file');
    expect(native).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it('reports a not-found path', () => {
    const [text] = resolveAttachments([{ path: join(dir, 'missing.txt'), type: 'file' }], 'anthropic', 'sonnet');
    expect(text).toContain('not found');
  });

  it('emits a native PDF document block for anthropic, tagged cache_control:ephemeral', () => {
    const p = join(dir, 'doc.pdf');
    writeFileSync(p, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x41)]));
    const [, native, refusals] = resolveAttachments([{ path: p, type: 'file' }], 'anthropic', 'sonnet');
    expect(refusals).toEqual([]);
    expect(native.length).toBe(1);
    expect(native[0].type).toBe('document');
    expect(native[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('refuses a PDF on a Codex model even though the openai family otherwise supports it', () => {
    const p = join(dir, 'doc.pdf');
    writeFileSync(p, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x41)]));
    const [, native, refusals] = resolveAttachments([{ path: p, type: 'file' }], 'openai', 'gpt-5.3-codex');
    expect(native).toEqual([]);
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain('Codex');
  });

  it('builds a directory tree for a context_directory entry', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'y');
    const lines = buildDirTree(dir);
    expect(lines).toContain('a.txt');
    expect(lines).toContain('sub/');
    expect(lines).toContain('  b.txt');
  });

  it('returns empty for no context paths', () => {
    expect(resolveAttachments(null, 'anthropic', 'sonnet')).toEqual(['', [], []]);
    expect(resolveAttachments([], 'anthropic', 'sonnet')).toEqual(['', [], []]);
  });
});

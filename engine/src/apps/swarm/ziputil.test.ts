// engine/src/apps/swarm/ziputil.test.ts -- SUB-3, vitest twin of backend/tests/
// test_swarm_bundle.py's zip-hardening rejection cases: zip-slip, absolute paths, symlinks, entry
// count, and format-version rejection (the last exercised through closure.ts, see closure.test.ts).

import { crc32 } from 'node:zlib';
import { rmSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { BundleError, MAX_ENTRIES, unpack } from './ziputil';

async function zipWith(entries: Record<string, string | { data: string; unixPermissions?: number }>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, v] of Object.entries(entries)) {
    if (typeof v === 'string') {
      zip.file(name, v);
    } else {
      zip.file(name, v.data, { unixPermissions: v.unixPermissions });
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Hand-rolled, minimal STORED-method zip writer for adversarial test fixtures ONLY --
 * jszip's own high-level `.file()` API silently NORMALIZES a name like `../escape.txt` at write
 * time (verified: it drops the `../` and produces a plain `escape.txt` entry plus a `/` directory
 * entry), which would make a test built on it prove nothing about unpack()'s own zip-slip/symlink
 * defenses -- a real attacker's tool (or Python's zipfile, which backend/tests/test_swarm_bundle.py
 * itself uses to build these exact adversarial fixtures) has no such courtesy. This writes the
 * literal bytes of a local file header + central directory + EOCD with the exact name/external-attr
 * given, no normalization. */
function buildRawZip(entries: Array<{ name: string; data: Buffer; externalAttr?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const { name, data, externalAttr = 0 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // gp flag
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // version made by: unix (high byte 3), version 20
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // gp flag
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attrs
    central.writeUInt32LE(externalAttr >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }
  const centralStart = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, eocd]);
}

describe('unpack() hardening', () => {
  test('a ../ entry never lands outside the sandbox (zip-slip)', async () => {
    // Two independent layers guard this, and this test proves the OUTCOME rather than picking one
    // mechanism: jszip's own loader (lib/utils.js's resolve(), called from load.js on every entry
    // name) already collapses "../escape.txt" down to the harmless relative "escape.txt" before
    // this module ever sees an entry name -- verified directly against this exact fixture, so
    // `entry.name` reaching safeMemberPath() below is never the raw ".." form. safeMemberPath()'s
    // own dest.startsWith(root) check is the second, independent layer for any name that ever DID
    // arrive un-resolved (e.g. a future jszip version, or a name jszip's resolve() doesn't fully
    // neutralize). Either way, the file must never exist outside the sandbox after unpack().
    const raw = buildRawZip([{ name: '../escape.txt', data: Buffer.from('x') }]);
    const sandbox = await unpack(raw);
    try {
      const { existsSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      expect(existsSync(join(dirname(sandbox), 'escape.txt'))).toBe(false);
      expect(existsSync(join(sandbox, 'escape.txt'))).toBe(true); // safely contained instead
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });


  test('rejects an absolute path entry', async () => {
    const raw = buildRawZip([{ name: '/etc/evil', data: Buffer.from('x') }]);
    await expect(unpack(raw)).rejects.toBeInstanceOf(BundleError);
  });

  test('rejects a Windows-style absolute path entry (C:\\...)', async () => {
    const raw = buildRawZip([{ name: 'C:\\evil.txt', data: Buffer.from('x') }]);
    await expect(unpack(raw)).rejects.toBeInstanceOf(BundleError);
  });

  test('rejects a symlink entry before writing anything', async () => {
    // 0o120777 << 16 in the external_attr field -- exact same bit pattern
    // test_symlink_entry_rejected constructs via zipfile.ZipInfo.external_attr.
    const raw = buildRawZip([{ name: 'link', data: Buffer.from('/etc/passwd'), externalAttr: 0o120777 << 16 }]);
    await expect(unpack(raw)).rejects.toBeInstanceOf(BundleError);
  });

  test('rejects too many entries', async () => {
    const zip = new JSZip();
    for (let i = 0; i < MAX_ENTRIES + 1; i += 1) zip.file(`f${i}.txt`, 'x');
    const raw = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(unpack(raw)).rejects.toBeInstanceOf(BundleError);
  });

  test('rejects an oversized single entry (header-declared uncompressed size over the per-file cap)', async () => {
    // A real 25MB+1 byte payload compresses trivially (all zeros) so this doesn't actually need
    // 25MB of entropy on disk -- it genuinely IS that large uncompressed, which is exactly the
    // header check under test (not the streaming-cap fallback).
    const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0);
    const zip = new JSZip();
    zip.file('big.bin', big);
    const raw = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(unpack(raw)).rejects.toBeInstanceOf(BundleError);
  }, 20000);

  test('accepts a small, well-formed zip and extracts real content', async () => {
    const raw = await zipWith({ 'manifest.json': '{"format_version":1}', 'entities/x/payload.json': '{"a":1}' });
    const sandbox = await unpack(raw);
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      expect(readFileSync(join(sandbox, 'manifest.json'), 'utf8')).toBe('{"format_version":1}');
      expect(readFileSync(join(sandbox, 'entities/x/payload.json'), 'utf8')).toBe('{"a":1}');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test('rejects a bundle larger than MAX_TOTAL_BYTES outright', async () => {
    const { MAX_TOTAL_BYTES } = await import('./ziputil');
    const oversized = Buffer.alloc(MAX_TOTAL_BYTES + 1);
    await expect(unpack(oversized)).rejects.toBeInstanceOf(BundleError);
  });

  test('rejects a non-zip blob', async () => {
    await expect(unpack(Buffer.from('not a zip at all'))).rejects.toBeInstanceOf(BundleError);
  });
});

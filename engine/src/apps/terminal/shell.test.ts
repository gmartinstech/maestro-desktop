import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { findOnPath, resolveShell, windowsPowershellFallback } from './shell';

describe('resolveShell (Windows)', () => {
  test.skipIf(process.platform !== 'win32')('resolves to an absolute, existing executable', () => {
    const [file, ...args] = resolveShell();
    expect(existsSync(file)).toBe(true);
    expect(args).toContain('-NoLogo');
  });

  test.skipIf(process.platform !== 'win32')('falls back to the always-present Windows PowerShell when pwsh is not on PATH', () => {
    const [file] = resolveShell({ ...process.env, Path: 'C:\\definitely-not-a-real-dir' });
    expect(file).toBe(windowsPowershellFallback());
    expect(existsSync(file)).toBe(true);
  });
});

describe('windowsPowershellFallback', () => {
  test('builds the path under SystemRoot', () => {
    const path = windowsPowershellFallback();
    expect(path.toLowerCase()).toContain('windowspowershell');
    expect(path.toLowerCase().endsWith('powershell.exe')).toBe(true);
  });
});

describe('findOnPath', () => {
  test('returns null for a binary name that cannot exist', () => {
    expect(findOnPath('definitely-not-a-real-binary-xyz.exe')).toBeNull();
  });
});

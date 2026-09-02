import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { terminalCwd } from './workspaceCwd';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-terminal-cwd-'));
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('terminalCwd', () => {
  test('resolves to the workspace folder when it exists', () => {
    mkdirSync(join(dataRoot, 'outputs_workspace', 'ws-1'), { recursive: true });
    const env = { MAESTRO_DATA_ROOT: dataRoot };
    expect(terminalCwd('ws-1', env)).toBe(join(dataRoot, 'outputs_workspace', 'ws-1'));
  });

  test('falls back to home when the workspace folder does not exist', () => {
    const env = { MAESTRO_DATA_ROOT: dataRoot };
    expect(terminalCwd('never-created', env)).toBe(homedir());
  });

  test('falls back to home when the path exists but is a file, not a directory', () => {
    mkdirSync(join(dataRoot, 'outputs_workspace'), { recursive: true });
    const filePath = join(dataRoot, 'outputs_workspace', 'not-a-dir');
    writeFileSync(filePath, 'x');
    const env = { MAESTRO_DATA_ROOT: dataRoot };
    expect(terminalCwd('not-a-dir', env)).toBe(homedir());
  });
});

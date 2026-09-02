// engine/src/apps/swarm/entities/modeExportable.test.ts -- SUB-3, direct unit coverage of
// ModeExportable (no dedicated backend/tests/ file exercises modes.py's ModeExportable directly --
// confirmed by search; it's only exercised indirectly through a dashboard/session bundle in
// backend/tests/test_swarm_bundle.py, which doesn't happen to use a custom mode in its fixtures).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadModeByIdOrNull, saveMode } from '../../modes/store';
import { ModeExportable } from './modeExportable';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-swarm-mode-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

describe('ModeExportable', () => {
  test('load() returns null for a mode that does not exist', () => {
    expect(ModeExportable.load('ghost-mode')).toBeNull();
  });

  test('serialize() drops is_builtin and default_folder', () => {
    saveMode({
      id: 'my-mode', name: 'My Mode', description: 'desc', system_prompt: 'be helpful',
      tools: ['Read'], default_next_mode: null, is_builtin: false, icon: 'smart_toy', color: '#000',
      default_folder: '/some/machine/path',
    });
    const ex = ModeExportable.load('my-mode')!;
    const out = ex.serialize({ bundleIdFor: () => null }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('is_builtin');
    expect(out).not.toHaveProperty('default_folder');
    expect(out.name).toBe('My Mode');
    expect(out.system_prompt).toBe('be helpful');
  });

  test('import_ reuses an existing same-slug mode rather than clobbering it', () => {
    saveMode({
      id: 'existing', name: 'Existing', description: '', system_prompt: null, tools: null,
      default_next_mode: null, is_builtin: false, icon: 'smart_toy', color: '#000', default_folder: null,
    });
    const id = ModeExportable.import_({ id: 'existing', name: 'Incoming Overwrite Attempt' }, {}, null);
    expect(id).toBe('existing');
    expect(loadModeByIdOrNull('existing')!.name).toBe('Existing'); // untouched, not overwritten
  });

  test('import_ creates a fresh, non-builtin mode when the slug is free', () => {
    const id = ModeExportable.import_({ id: 'brand-new', name: 'Brand New', system_prompt: 'hi', tools: ['Read'] }, {}, null);
    expect(id).toBe('brand-new');
    const saved = loadModeByIdOrNull('brand-new')!;
    expect(saved.name).toBe('Brand New');
    expect(saved.is_builtin).toBe(false);
    expect(saved.system_prompt).toBe('hi');
  });
});

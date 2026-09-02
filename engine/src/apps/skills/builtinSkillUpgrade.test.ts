// engine/src/apps/skills/builtinSkillUpgrade.test.ts -- SUB-2's vitest twin of backend/tests/
// test_builtin_skill_upgrade.py.
//
// Built-in skills must follow the bundled source across upgrades unless the user edited them.
// Seeding used to be create-if-absent, which pinned every install to whatever shipped the day it
// first booted: the App Builder agent's prompt kept a months-old skill and so never learned that
// `.maestro/terminal.log` existed. `seeded_hash` records the bytes we last wrote so an untouched
// file can be safely replaced, while a real edit (or an untracked pre-existing install) is left
// alone.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resetSkillsDirForTests, seedBuiltInSkills, setBuiltInSkillRegistryForTests, setSkillsDirForTests } from './skills';

let dir: string;
let sourcePath: string;

/** A stubbed SKILLS_DIR plus a one-entry built-in registry pointing at a bundle we control --
 * mirrors the Python suite's `seeded` fixture. */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-engine-builtin-skill-test-'));
  setSkillsDirForTests(dir);
  sourcePath = join(dir, '..', `bundled-${Math.random().toString(16).slice(2)}.md`);
  writeFileSync(sourcePath, 'v1 bundled', 'utf8');
  setBuiltInSkillRegistryForTests(() => [
    { id: 'app_builder_skill', name: 'App Builder', description: 'd', command: 'app-builder-skill', source_path: sourcePath },
  ]);
});

afterEach(() => {
  setBuiltInSkillRegistryForTests(null);
  resetSkillsDirForTests();
  rmSync(dir, { recursive: true, force: true });
  rmSync(sourcePath, { force: true });
});

function skillPath(): string {
  return join(dir, 'app_builder_skill.md');
}

function readSkill(): string {
  return readFileSync(skillPath(), 'utf8');
}

describe('built-in skill upgrade tracking', () => {
  test('an unedited copy upgrades when the bundle changes', () => {
    seedBuiltInSkills();
    writeFileSync(sourcePath, 'v2 bundled with terminal.log', 'utf8');
    seedBuiltInSkills();
    expect(readSkill()).toBe('v2 bundled with terminal.log');
  });

  test('a user edit is preserved across a bundle bump', () => {
    seedBuiltInSkills();
    writeFileSync(skillPath(), 'my own house rules', 'utf8');
    writeFileSync(sourcePath, 'v2 bundled', 'utf8');
    seedBuiltInSkills();
    expect(readSkill()).toBe('my own house rules');
  });

  test('a second boot does not clobber a preserved edit', () => {
    // Regression: adopting the CURRENT bytes as provenance would make the next boot treat a real
    // edit as unedited.
    seedBuiltInSkills();
    writeFileSync(skillPath(), 'my own house rules', 'utf8');
    writeFileSync(sourcePath, 'v2 bundled', 'utf8');
    seedBuiltInSkills();
    seedBuiltInSkills();
    expect(readSkill()).toBe('my own house rules');
  });

  test('an untracked stale install is never clobbered', () => {
    // The real-world bug: a file seeded before seeded_hash existed. Indistinguishable from an
    // edit, so leave it.
    writeFileSync(skillPath(), 'stale bundle from an old install', 'utf8');
    writeFileSync(sourcePath, 'v2 bundled', 'utf8');
    seedBuiltInSkills();
    expect(readSkill()).toBe('stale bundle from an old install');
    const index = JSON.parse(readFileSync(join(dir, '.skills_index.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    expect(index.app_builder_skill.seeded_hash).toBeUndefined();
  });
});

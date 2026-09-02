// engine/src/apps/skillRegistry/skillRegistryGithub.test.ts -- SUB-2's vitest twin of the PURE
// logic portions of backend/tests/test_skill_registry_community.py: SKILL.md selection at
// arbitrary repo depth and script-path classification. The network parts (GitHub trees + raw
// fetch) are exercised in skillRegistrySources.test.ts against a faked engineFetch, same division
// the Python original documents ("smoked manually" there; here, a fake HTTP layer instead).

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { githubHeaders, isScriptPath, selectSkillPaths, treeBlobPaths, type GithubTreeEntry } from './skillRegistryGithub';

describe('selectSkillPaths', () => {
  test('selects the shortest matching SKILL.md at any depth', () => {
    const tree: GithubTreeEntry[] = [
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'plugins/x/skills/pdftk/SKILL.md' },
      { type: 'blob', path: 'plugins/x/skills/pdftk/run.sh' },
      { type: 'blob', path: 'plugins/x/skills/pdftk/templates/form.txt' },
      { type: 'blob', path: 'plugins/x/skills/other/SKILL.md' },
    ];
    const [skillMd, members] = selectSkillPaths(tree, 'pdftk');
    expect(skillMd).toBe('plugins/x/skills/pdftk/SKILL.md');
    expect(new Set(members)).toEqual(
      new Set(['plugins/x/skills/pdftk/SKILL.md', 'plugins/x/skills/pdftk/run.sh', 'plugins/x/skills/pdftk/templates/form.txt']),
    );
    // The unrelated 'other' skill's files are excluded.
    expect(members.every((m) => !m.includes('/other/'))).toBe(true);
  });

  test('a top-level SKILL.md', () => {
    const tree: GithubTreeEntry[] = [
      { type: 'blob', path: 'pdftk/SKILL.md' },
      { type: 'blob', path: 'pdftk/x.py' },
    ];
    const [skillMd, members] = selectSkillPaths(tree, 'pdftk');
    expect(skillMd).toBe('pdftk/SKILL.md');
    expect(members).toContain('pdftk/x.py');
  });

  test('a missing skill throws', () => {
    expect(() => selectSkillPaths([{ type: 'blob', path: 'a/SKILL.md' }], 'nonexistent')).toThrow();
  });

  test('an ambiguous match picks deterministically', () => {
    // Several <x>/pdf/SKILL.md: a top-level pdf/ wins, else skills/pdf/, never arbitrary.
    const tree: GithubTreeEntry[] = [
      { type: 'blob', path: 'plugins/z/pdf/SKILL.md' },
      { type: 'blob', path: 'skills/pdf/SKILL.md' },
      { type: 'blob', path: 'pdf/SKILL.md' },
    ];
    const [skillMd] = selectSkillPaths(tree, 'pdf');
    expect(skillMd).toBe('pdf/SKILL.md');

    // Without a top-level one, prefer skills/<id>/.
    const tree2: GithubTreeEntry[] = [
      { type: 'blob', path: 'plugins/z/pdf/SKILL.md' },
      { type: 'blob', path: 'skills/pdf/SKILL.md' },
    ];
    const [skillMd2] = selectSkillPaths(tree2, 'pdf');
    expect(skillMd2).toBe('skills/pdf/SKILL.md');
  });
});

describe('githubHeaders', () => {
  let savedMaestroToken: string | undefined;
  let savedGithubToken: string | undefined;

  beforeEach(() => {
    savedMaestroToken = process.env.MAESTRO_GITHUB_TOKEN;
    savedGithubToken = process.env.GITHUB_TOKEN;
    delete process.env.MAESTRO_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => {
    if (savedMaestroToken === undefined) delete process.env.MAESTRO_GITHUB_TOKEN;
    else process.env.MAESTRO_GITHUB_TOKEN = savedMaestroToken;
    if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedGithubToken;
  });

  test('adds a token when set', () => {
    expect(githubHeaders().Authorization).toBeUndefined();
    process.env.MAESTRO_GITHUB_TOKEN = 'ghp_test';
    expect(githubHeaders().Authorization).toBe('Bearer ghp_test');
  });
});

describe('isScriptPath / treeBlobPaths', () => {
  test('script classification', () => {
    expect(isScriptPath('run.sh')).toBe(true);
    expect(isScriptPath('helper.py')).toBe(true);
    expect(isScriptPath('scripts/build.txt')).toBe(true); // under a scripts/ dir
    expect(isScriptPath('bin/tool')).toBe(true);
    expect(isScriptPath('SKILL.md')).toBe(false);
    expect(isScriptPath('templates/form.html')).toBe(false);
    expect(isScriptPath('data.json')).toBe(false);
  });

  test('treeBlobPaths ignores tree entries', () => {
    const tree: GithubTreeEntry[] = [
      { type: 'tree', path: 'skills' },
      { type: 'blob', path: 'skills/x/SKILL.md' },
    ];
    expect(treeBlobPaths(tree)).toEqual(['skills/x/SKILL.md']);
  });
});

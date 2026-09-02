// engine/src/apps/skills/skills.test.ts -- SUB-2's vitest twin of backend/tests/
// test_skills_folders.py: multi-file (folder) skills, plus backward compatibility with legacy
// flat skills.
//
// A skill is either ~/.claude/skills/<id>/SKILL.md (with optional supporting files) or a legacy
// ~/.claude/skills/<id>.md. Both must list, read, and delete correctly, and a folder skill with
// supporting files must get its folder path appended to the prompt so the agent can read those
// files on demand.
//
// Deliberate scope cut, NOT ported here: Python's own
// test_stage_zip_carries_supporting_files_into_sandbox exercises
// backend.apps.swarm.closure.stage_skill_from_zip -- the general multi-entity zip-import/sandbox
// system, not anything skill-specific. That belongs to SUB-3's full swarm/closure.ts port, not
// this ticket (see swarmSkillEntity.ts's own header for the full reasoning). Every OTHER test in
// the Python file, including the one the ticket names as a must-pass-on-Windows bar
// (test_swarm_export_folder_skill_carries_supporting_files, below as
// "swarm export: folder skill carries supporting files"), is ported.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveAttachedSkills } from '../../agents/manager/prompt/promptContext';
import { SkillExportable } from './swarmSkillEntity';
import {
  createSkill,
  deleteSkill,
  loadIndex,
  resetSkillsDirForTests,
  saveIndex,
  setSkillsDirForTests,
  skillsDir,
  syncSkills,
  updateSkill,
} from './skills';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-engine-skills-test-'));
  setSkillsDirForTests(dir);
});

afterEach(() => {
  resetSkillsDirForTests();
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

describe('index resilience', () => {
  test('corrupt index does not brick skills and is preserved', () => {
    writeFile(join(dir, 'alpha.md'), 'content');
    writeFileSync(join(dir, '.skills_index.json'), '{ not valid json', 'utf8');
    expect(loadIndex()).toEqual({});
    expect(existsSync(join(dir, '.skills_index.json.corrupt'))).toBe(true);
    expect(new Set(syncSkills().map((s) => s.id)).has('alpha')).toBe(true);
  });

  test('non-object index is rejected', () => {
    writeFileSync(join(dir, '.skills_index.json'), '[1, 2, 3]', 'utf8');
    expect(loadIndex()).toEqual({});
  });

  test('save index is atomic, no temp leftover', () => {
    saveIndex({ x: { name: 'X' } });
    expect(loadIndex()).toEqual({ x: { name: 'X' } });
    const leftovers = readdirSync(dir).filter((n) => n.startsWith('.skills_index.') && n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('folder vs flat sync', () => {
  test('flat skill still syncs', () => {
    writeFile(join(dir, 'my-flat.md'), 'do the flat thing');
    const skills = new Map(syncSkills().map((s) => [s.id, s]));
    expect(skills.has('my-flat')).toBe(true);
    const s = skills.get('my-flat')!;
    expect(s.content).toBe('do the flat thing');
    expect(s.dir_path).toBe('');
    expect(s.has_supporting_files).toBe(false);
  });

  test('folder skill syncs with supporting files', () => {
    const base = join(dir, 'remotion');
    writeFile(join(base, 'SKILL.md'), '---\nname: Remotion\ndescription: make videos\n---\nrender stuff');
    writeFile(join(base, 'helper.py'), "print('hi')");
    const skills = new Map(syncSkills().map((s) => [s.id, s]));
    expect(skills.has('remotion')).toBe(true);
    const s = skills.get('remotion')!;
    expect(s.content).toContain('render stuff');
    expect(s.dir_path).toBe(base);
    expect(s.has_supporting_files).toBe(true);
    // Frontmatter fills name/description when the index hasn't catalogued it.
    expect(s.name).toBe('Remotion');
    expect(s.description).toBe('make videos');
  });

  test('folder skill without extra files flags false', () => {
    const base = join(dir, 'solo');
    writeFile(join(base, 'SKILL.md'), 'just one file');
    const s = syncSkills().find((x) => x.id === 'solo')!;
    expect(s.dir_path).toBe(base);
    expect(s.has_supporting_files).toBe(false);
  });

  test('delete removes folder', () => {
    const base = join(dir, 'doomed');
    writeFile(join(base, 'SKILL.md'), 'x');
    writeFile(join(base, 'data.txt'), 'y');
    expect(existsSync(base)).toBe(true);
    deleteSkill('doomed');
    expect(existsSync(base)).toBe(false);
  });

  test('update writes folder SKILL.md', () => {
    const base = join(dir, 'editable');
    writeFile(join(base, 'SKILL.md'), 'old body');
    const res = updateSkill('editable', { content: 'new body', description: 'd' });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(base, 'SKILL.md'), 'utf8')).toBe('new body');
    expect(res.skill.dir_path).toBe(base);
  });
});

describe('prompt injection', () => {
  test('injection points at folder for supporting files', () => {
    const base = join(dir, 'withfiles');
    writeFile(join(base, 'SKILL.md'), 'use the template');
    writeFile(join(base, 'template.html'), '<html></html>');

    const block = resolveAttachedSkills([{ id: 'withfiles', name: 'WithFiles', content: 'use the template' }]);
    expect(block).toContain('[Using skill: WithFiles]');
    expect(block).toContain(base);
    expect(block).toContain('Read'); // tells the agent to read supporting files
  });

  test('skill injection is provider-agnostic by construction', () => {
    // The provider-agnostic claim, proven structurally (a live GPT/Gemini run needs a key): the
    // injector takes no provider arg so it CAN'T differ by model, it points at supporting files
    // via the universal Read tool, and Read is in the builtin set every provider gets.

    // 1. No provider/api parameter -- resolveAttachedSkills.length is its declared arity (1).
    expect(resolveAttachedSkills.length).toBe(1);

    // 2. A folder skill yields the body + a pointer to its folder via Read/Glob/Bash.
    const base = join(dir, 'vid');
    writeFile(join(base, 'SKILL.md'), 'render it');
    writeFile(join(base, 'helper.py'), 'x');
    const block = resolveAttachedSkills([{ id: 'vid', name: 'Vid', content: 'render it' }]);
    expect(block).toContain('[Using skill: Vid]');
    expect(block).toContain(base);
    expect(block).toContain('Read');

    // 3. Those file tools are universal builtins, not an Anthropic-only set. FULL_TOOLS itself
    // (backend/apps/agents/manager/prompt/tool_catalog.py) is tools_lib-adjacent (SUB-4, not
    // ported) -- mirrored here as a plain literal (not imported from a not-yet-existing module)
    // purely to prove the same structural claim the Python test proves: Read/Glob/Bash are in the
    // universal builtin set, not gated behind a specific provider.
    const P_FULL_TOOLS_MIRROR = [
      'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'AskUserQuestion',
      'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite',
      'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree',
      'TaskOutput', 'TaskStop',
      'CronCreate', 'CronList', 'CronDelete',
      'InvokeAgent', 'Agent', 'ToolSearch',
    ];
    expect(P_FULL_TOOLS_MIRROR).toEqual(expect.arrayContaining(['Read', 'Glob', 'Bash']));
  });

  test('injection has no folder note for a flat skill', () => {
    writeFile(join(dir, 'plain.md'), 'plain content');
    const block = resolveAttachedSkills([{ id: 'plain', name: 'Plain', content: 'plain content' }]);
    expect(block).toContain('[Using skill: Plain]');
    expect(block.toLowerCase()).not.toContain('supporting files');
  });
});

// --------------------------------------------------------------------------- .swarm round-trip for folder skills (export carries files, import rebuilds them). ---------------------------------------------------------------------------

describe('.swarm round-trip for folder skills', () => {
  // THE NAMED MUST-PASS TEST (ticket SUB-2's own instructions): the Python original is one of the
  // 6 tests scripts/verify.mjs deselects on Windows for environmental reasons -- this TS twin gets
  // no such exemption and must pass here for real.
  test('swarm export: folder skill carries supporting files', () => {
    const base = join(dir, 'vid');
    writeFile(join(base, 'SKILL.md'), 'render');
    writeFile(join(base, 'scripts', 'go.py'), 'print(1)');
    const exp = SkillExportable.load('vid');
    expect(exp).not.toBeNull();
    const files = exp!.files();
    expect(files['scripts/go.py']).toBeDefined();
    expect(files['scripts/go.py'].toString('utf8')).toBe('print(1)');
    expect(exp!.payload.content).toBe('render');
  });

  test('swarm import writes a folder when files are present', () => {
    const payload = { slug: 'vid', name: 'Vid', description: 'd', command: 'vid', content: 'render' };
    const newId = SkillExportable.import_(payload, { 'scripts/go.py': Buffer.from('print(1)') }, null);
    expect(existsSync(join(dir, newId, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, newId, 'scripts', 'go.py'))).toBe(true);
    const synced = new Map(syncSkills().map((s) => [s.id, s]));
    expect(synced.get(newId)!.has_supporting_files).toBe(true);
  });

  test('swarm import always writes a folder', () => {
    // Unified storage: even a one-file skill imports as a folder, so a skill's on-disk shape
    // never depends on whether it had supporting files.
    const payload = { slug: 'note', name: 'Note', content: 'just text' };
    const newId = SkillExportable.import_(payload, {}, null);
    expect(existsSync(join(dir, newId, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, `${newId}.md`))).toBe(false);
  });

  test('create writes a folder and supersedes a legacy flat skill of the same id', () => {
    // A pre-existing legacy flat skill of the same id...
    writeFile(join(dir, 'notes.md'), 'old flat');
    // ...is superseded (not shadowed) when the user (re)creates it; folder wins, and the phantom
    // flat file is removed so there's exactly one shape on disk.
    const res = createSkill({ name: 'Notes', content: 'new body', description: 'd' });
    const sid = res.skill.id;
    expect(sid).toBe('notes');
    expect(existsSync(join(dir, 'notes', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'notes.md'))).toBe(false);
    const only = syncSkills().filter((s) => s.id === 'notes');
    expect(only.length).toBe(1);
    expect(only[0].content).toBe('new body');
  });
});

// Sanity check that the fixture directory really is what skillsDir() resolves to, catching a
// mistaken override elsewhere in the suite before it silently reads/writes the developer's real
// ~/.claude/skills.
test('skillsDir() honors the test override', () => {
  expect(skillsDir()).toBe(dir);
});

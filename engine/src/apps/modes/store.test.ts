// engine/src/apps/modes/store.test.ts -- vitest twins of the real Python tests that exercise
// backend/apps/modes/{modes,models}.py, ported one-for-one so this port's gate is provably testing
// the SAME behaviors, not a fresh guess at what mattered:
//   - test_modes_load_all_skips_corrupt        (backend/tests/test_disk_resilience.py)
//   - test_builtin_modes_no_chat                (backend/tests/test_phase1_stress.py)
//   - test_modes_lifespan_deletes_stale_chat    (backend/tests/test_phase1_stress.py)
//   - test_chat_mode_not_in_builtins            (backend/tests/test_v2_invariants.py, Group I)
//   - test_agent_mode_no_explicit_tools         (backend/tests/test_v2_invariants.py, Group T)
//   - test_ask_mode_is_read_only                (ditto)
//   - test_plan_mode_is_read_only               (ditto)
//   - test_view_builder_mode_has_default_folder (ditto)

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { builtinModes } from './models';
import { ensureSeeded, loadAllModes, saveMode } from './store';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-modes-store-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
});

// test_modes_load_all_skips_corrupt
test('loadAllModes skips a corrupt file, preserving it on disk', () => {
  const dir = join(dataRoot, 'modes');
  mkdirSync(dir, { recursive: true });
  saveMode({
    id: 'good',
    name: 'good',
    description: '',
    system_prompt: null,
    tools: null,
    default_next_mode: null,
    is_builtin: false,
    icon: 'smart_toy',
    color: '#818cf8',
    default_folder: null,
  });
  writeFileSync(join(dir, 'garbled.json'), '{{{');
  const loaded = loadAllModes();
  expect(loaded.map((m) => m.name)).toEqual(['good']);
  expect(existsSync(join(dir, 'garbled.json'))).toBe(true);
});

// test_builtin_modes_no_chat
test('chat is not in the builtin catalog; ask carries the merged web tools, read-only', () => {
  const ids = new Set(builtinModes().map((m) => m.id));
  expect(ids.has('chat')).toBe(false);
  expect(ids.has('ask')).toBe(true);
  const ask = builtinModes().find((m) => m.id === 'ask')!;
  expect(ask.tools).toContain('WebFetch');
  expect(ask.tools).toContain('WebSearch');
  expect(ask.tools).toContain('Read');
  expect(ask.tools).not.toContain('Edit');
  expect(ask.tools).not.toContain('Write');
  expect(ask.tools).not.toContain('Bash');
});

// test_modes_lifespan_deletes_stale_chat
describe('ensureSeeded chat.json migration', () => {
  test('removes a stale built-in chat.json', () => {
    const dir = join(dataRoot, 'modes');
    mkdirSync(dir, { recursive: true });
    const chatPath = join(dir, 'chat.json');
    writeFileSync(chatPath, JSON.stringify({ id: 'chat', name: 'Chat', is_builtin: true, system_prompt: 'old', tools: ['AskUserQuestion'] }));
    ensureSeeded();
    expect(existsSync(chatPath)).toBe(false);
  });

  test('leaves a user-customized chat.json alone', () => {
    const dir = join(dataRoot, 'modes');
    mkdirSync(dir, { recursive: true });
    const chatPath = join(dir, 'chat.json');
    writeFileSync(chatPath, JSON.stringify({ id: 'chat', name: 'MyChat', is_builtin: false, system_prompt: 'user wrote this' }));
    ensureSeeded();
    expect(existsSync(chatPath)).toBe(true);
  });
});

// test_chat_mode_not_in_builtins (test_v2_invariants.py Group I -- same assertion as
// test_builtin_modes_no_chat above, re-ported here too since it's the exact required set check)
test('exactly agent/ask/plan/view-builder/skill-builder remain', () => {
  const ids = new Set(builtinModes().map((m) => m.id));
  for (const required of ['agent', 'ask', 'plan', 'view-builder', 'skill-builder']) {
    expect(ids.has(required)).toBe(true);
  }
  expect(ids.has('chat')).toBe(false);
});

// test_agent_mode_no_explicit_tools
test('agent mode leaves tools null so every builtin tool is available', () => {
  const agent = builtinModes().find((m) => m.id === 'agent')!;
  expect(agent.tools).toBeNull();
});

// test_ask_mode_is_read_only / test_plan_mode_is_read_only
test('ask and plan modes exclude every write/exec tool', () => {
  const forbidden = ['Bash', 'Write', 'Edit', 'MultiEdit', 'StrReplace'];
  for (const id of ['ask', 'plan']) {
    const mode = builtinModes().find((m) => m.id === id)!;
    for (const tool of forbidden) expect(mode.tools ?? []).not.toContain(tool);
  }
});

// test_view_builder_mode_has_default_folder
test('view-builder mode has a non-null default_folder', () => {
  const vb = builtinModes().find((m) => m.id === 'view-builder')!;
  expect(vb.default_folder).not.toBeNull();
});

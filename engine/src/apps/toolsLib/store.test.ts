// engine/src/apps/toolsLib/store.test.ts -- vitest twins of the real Python tests that exercise
// backend/apps/tools_lib/tools_lib.py, ported one-for-one so this port's gate is provably testing
// the SAME behaviors, not a fresh guess at what mattered:
//   - test_tools_write_then_list_is_fresh / test_tools_delete_detected /
//     test_tools_in_place_rewrite_detected / test_tools_cached_hit_skips_reparse
//     (backend/tests/test_disk_caches.py)
//   - test_slot_for_builtin_tool / test_slot_for_our_browser_and_invoke_agents_uses_inner_name /
//     test_slot_for_community_mcp_points_at_the_owning_tool / test_slot_for_unknown_mcp_has_no_write_target /
//     test_always_approve_round_trips_for_every_tool_shape / test_two_actions_on_the_same_mcp_server_are_independent /
//     test_builtin_policy_survives_a_real_file_reload / test_mcp_policy_survives_a_real_tool_file_reload
//     (backend/tests/test_tool_policy_slot.py)

import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sanitizeServerName } from './mcpConfig';
import { makeToolDefinition, type ToolDefinition } from './models';
import {
  loadAllTools,
  loadBuiltinPermissions,
  resolvePolicySlot,
  saveBuiltinPermissions,
  saveTool,
  setBuiltinPermissionsPathForTests,
  setToolsDataDirForTests,
} from './store';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-tools-store-test-'));
  const toolsDir = join(dataRoot, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  setToolsDataDirForTests(toolsDir);
  setBuiltinPermissionsPathForTests(join(dataRoot, 'builtin_permissions.json'));
});

afterEach(() => {
  setToolsDataDirForTests(null);
  setBuiltinPermissionsPathForTests(null);
  rmSync(dataRoot, { recursive: true, force: true });
});

function bumpMtime(path: string): void {
  // FAT32-style coarse clocks could hide a same-size rewrite; force a distinct mtime, mirroring the
  // Python suite's own p_bump_mtime helper.
  const now = new Date();
  utimesSync(path, now, new Date(now.getTime() + 5));
}

describe('cache invalidation (test_disk_caches.py)', () => {
  test('write then list is fresh', () => {
    expect(loadAllTools()).toEqual([]);
    const t = makeToolDefinition({ name: 'Alpha', description: 'a' });
    saveTool(t);
    bumpMtime(join(dataRoot, 'tools', `${t.id}.json`));
    expect(loadAllTools().map((x) => x.name)).toEqual(['Alpha']);

    const t2 = makeToolDefinition({ name: 'Beta', description: 'b' });
    saveTool(t2);
    expect(loadAllTools().map((x) => x.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  test('delete detected', () => {
    const t = makeToolDefinition({ name: 'Gone', description: 'g' });
    saveTool(t);
    expect(loadAllTools().map((x) => x.name)).toEqual(['Gone']);
    rmSync(join(dataRoot, 'tools', `${t.id}.json`));
    expect(loadAllTools()).toEqual([]);
  });

  test('in-place rewrite detected', () => {
    const t = makeToolDefinition({ name: 'Old', description: 'x' });
    saveTool(t);
    expect(loadAllTools().map((x) => x.name)).toEqual(['Old']);
    t.name = 'New';
    saveTool(t);
    bumpMtime(join(dataRoot, 'tools', `${t.id}.json`));
    expect(loadAllTools().map((x) => x.name)).toEqual(['New']);
  });

  test('cached hit skips re-parse', () => {
    saveTool(makeToolDefinition({ name: 'Once', description: 'o' }));
    loadAllTools();
    const origParse = JSON.parse;
    JSON.parse = (): never => {
      throw new Error('disk re-parse on unchanged dir');
    };
    try {
      expect(loadAllTools().map((x) => x.name)).toEqual(['Once']);
    } finally {
      JSON.parse = origParse;
    }
  });
});

function mcpTool(name: string): ToolDefinition {
  return makeToolDefinition({ name, mcp_config: { command: 'x' }, enabled: true, tool_permissions: {} });
}

describe('resolvePolicySlot (test_tool_policy_slot.py)', () => {
  test('slot for builtin tool', () => {
    expect(resolvePolicySlot('Bash', [])).toEqual({ store: 'builtin', key: 'Bash', action: null });
    expect(resolvePolicySlot('Read', [])).toEqual({ store: 'builtin', key: 'Read', action: null });
  });

  test('slot for our browser and invoke agents uses inner name', () => {
    expect(resolvePolicySlot('mcp__maestro-browser-agent__BrowserAgent', [])).toEqual({ store: 'builtin', key: 'BrowserAgent', action: null });
    expect(resolvePolicySlot('mcp__maestro-invoke-agent__InvokeAgent', [])).toEqual({ store: 'builtin', key: 'InvokeAgent', action: null });
  });

  test('slot for community mcp points at the owning tool', () => {
    const tool = mcpTool('My Notion Server');
    const slug = sanitizeServerName(tool.name);
    expect(resolvePolicySlot(`mcp__${slug}__notion-fetch`, [tool])).toEqual({ store: 'mcp', key: tool.id, action: 'notion-fetch' });
  });

  test('slot for unknown mcp has no write target', () => {
    expect(resolvePolicySlot('mcp__ghostserver__do-thing', [])).toEqual({ store: 'mcp', key: null, action: 'do-thing' });
  });
});

// Mirrors test_tool_policy_slot.py's p_read/p_write helpers: both key through resolvePolicySlot.
function readPolicy(toolName: string, builtinPerms: Record<string, string>, tools: ToolDefinition[]): string {
  const slot = resolvePolicySlot(toolName, tools);
  if (slot.store === 'builtin') return builtinPerms[slot.key as string] ?? 'ask';
  if (slot.key !== null) {
    const t = tools.find((tt) => tt.id === slot.key);
    if (t) return (t.tool_permissions[slot.action as string] as string | undefined) ?? 'ask';
  }
  return 'ask';
}
function writePolicy(toolName: string, policy: string, builtinPerms: Record<string, string>, tools: ToolDefinition[]): void {
  const slot = resolvePolicySlot(toolName, tools);
  if (slot.store === 'builtin') {
    builtinPerms[slot.key as string] = policy;
    return;
  }
  if (slot.key !== null) {
    const t = tools.find((tt) => tt.id === slot.key);
    if (t) t.tool_permissions[slot.action as string] = policy;
  }
}

describe('always-approve invariant (test_tool_policy_slot.py)', () => {
  test('always approve round trips for every tool shape', () => {
    const notion = mcpTool('Notion');
    const slug = sanitizeServerName('Notion');
    const tools = [notion];
    const builtinPerms: Record<string, string> = {};

    const shapes = ['Bash', 'Read', 'mcp__maestro-browser-agent__BrowserAgent', 'mcp__maestro-invoke-agent__InvokeAgent', `mcp__${slug}__notion-fetch`];
    for (const toolName of shapes) {
      expect(readPolicy(toolName, builtinPerms, tools)).not.toBe('always_allow');
      writePolicy(toolName, 'always_allow', builtinPerms, tools);
      expect(readPolicy(toolName, builtinPerms, tools)).toBe('always_allow');
    }
  });

  test('two actions on the same mcp server are independent', () => {
    const tool = mcpTool('Notion');
    const slug = sanitizeServerName('Notion');
    const tools = [tool];
    const bp: Record<string, string> = {};
    writePolicy(`mcp__${slug}__notion-fetch`, 'always_allow', bp, tools);
    expect(readPolicy(`mcp__${slug}__notion-fetch`, bp, tools)).toBe('always_allow');
    expect(readPolicy(`mcp__${slug}__notion-create-pages`, bp, tools)).toBe('ask');
  });
});

describe('real file persistence (test_tool_policy_slot.py integration)', () => {
  test('builtin policy survives a real file reload', () => {
    const slot = resolvePolicySlot('Read', []);
    const perms = loadBuiltinPermissions();
    perms[slot.key as string] = 'always_allow';
    saveBuiltinPermissions(perms);
    const reloaded = loadBuiltinPermissions();
    expect(reloaded[resolvePolicySlot('Read', []).key as string]).toBe('always_allow');
  });

  test('mcp policy survives a real tool file reload', () => {
    saveTool(mcpTool('Notion'));
    const slug = sanitizeServerName('Notion');
    const name = `mcp__${slug}__notion-fetch`;

    const tools = loadAllTools();
    const slot = resolvePolicySlot(name, tools);
    const target = tools.find((t) => t.id === slot.key)!;
    target.tool_permissions[slot.action as string] = 'always_allow';
    saveTool(target);

    const tools2 = loadAllTools();
    const rslot = resolvePolicySlot(name, tools2);
    const got = tools2.find((t) => t.id === rslot.key)!;
    expect(got.tool_permissions[rslot.action as string]).toBe('always_allow');
  });
});

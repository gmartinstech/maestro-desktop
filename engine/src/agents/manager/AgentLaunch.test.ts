// engine/src/agents/manager/AgentLaunch.test.ts -- AGT-5. The ticket's own explicit instruction:
// "port the FIXED behaviour... and carry over the distinction the fix introduced" -- the state
// home decides the workspace LOCATION, but ensureCwdGitRepo's second argument is always the REAL
// home, because it only builds the never-git-init-here guard. This file's first describe block is
// a standing regression test for exactly that distinction; getting it backwards silently
// reintroduces CTR-4's original bug (a session with no explicit directory writing a real
// git-init'd workspace into the developer's ACTUAL home when MAESTRO_STATE_HOME is overridden).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentConfig } from '../core/models';
import { DEFAULT_ALLOWED_TOOLS } from '../core/models';
import { launchAgent } from './AgentLaunch';
import { pStateHome, realHome } from './statePaths';

function pConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'test',
    model: 'sonnet',
    mode: 'agent',
    provider: 'anthropic',
    system_prompt: null,
    allowed_tools: [...DEFAULT_ALLOWED_TOOLS],
    max_turns: null,
    target_directory: null,
    dashboard_id: null,
    workflow_run_id: null,
    workflow_edit_id: null,
    selected_app_output_ids: null,
    initial_message: null,
    ...overrides,
  };
}

const noSettingsDefaultFolder = () => ({ settings: { default_folder: null, default_thinking_level: 'auto' } });

describe('launchAgent: the state-home-vs-real-home split (regression test for the AgentLaunch fix)', () => {
  let overrideHome: string;
  let savedStateHome: string | undefined;

  beforeEach(() => {
    overrideHome = mkdtempSync(join(tmpdir(), 'maestro-state-home-'));
    savedStateHome = process.env.MAESTRO_STATE_HOME;
    process.env.MAESTRO_STATE_HOME = overrideHome;
  });

  afterEach(() => {
    if (savedStateHome === undefined) delete process.env.MAESTRO_STATE_HOME;
    else process.env.MAESTRO_STATE_HOME = savedStateHome;
    rmSync(overrideHome, { recursive: true, force: true });
  });

  it('a launch with no target_directory/mode_folder/default_folder resolves under the OVERRIDE state home, not the real developer home', async () => {
    const sessions = new Map();
    const session = await launchAgent(sessions, pConfig(), { loadSettings: noSettingsDefaultFolder });

    // The bug this guards against: session.cwd landing under the REAL os home (process.env.HOME /
    // USERPROFILE) instead of the MAESTRO_STATE_HOME override -- that's exactly the real-profile
    // contamination CTR-4 found. Asserted precisely (not just "doesn't start with the real home",
    // which can false-negative on Windows where the test's own scratch tmpdir sits under
    // %USERPROFILE%\AppData\Local\Temp): the fallback chain must land at EXACTLY
    // <override>/.maestro/workspaces/<sessionId>, never at <realHome>/.maestro/workspaces/<...>.
    expect(session.cwd).toBeTruthy();
    const cwd = resolve(session.cwd!);
    expect(cwd.startsWith(resolve(overrideHome))).toBe(true);
    expect(cwd).toBe(resolve(overrideHome, '.maestro', 'workspaces', session.id));
    const real = realHome();
    if (real && resolve(real) !== resolve(overrideHome)) {
      expect(cwd).not.toBe(resolve(real, '.maestro', 'workspaces', session.id));
    }
  });

  it('pStateHome() itself reads the override, and differs from realHome() while the override is set', () => {
    expect(resolve(pStateHome())).toBe(resolve(overrideHome));
    const real = realHome();
    if (real) expect(resolve(pStateHome())).not.toBe(resolve(real));
  });
});

describe('launchAgent: basic construction', () => {
  it('registers the session and resolves a real target_directory as cwd (no state-home reroute)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-launch-'));
    try {
      const sessions = new Map();
      const session = await launchAgent(sessions, pConfig({ target_directory: dir, name: 'my session' }), {
        loadSettings: noSettingsDefaultFolder,
      });
      expect(sessions.get(session.id)).toBe(session);
      expect(resolve(session.cwd!)).toBe(resolve(dir));
      expect(session.name).toBe('my session');
      expect(session.mode).toBe('agent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('view-builder mode with no target_directory nests a per-session subfolder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-vb-'));
    const savedStateHome = process.env.MAESTRO_STATE_HOME;
    process.env.MAESTRO_STATE_HOME = dir;
    try {
      const sessions = new Map();
      const session = await launchAgent(
        sessions,
        pConfig({ mode: 'view-builder' }),
        { loadSettings: () => ({ settings: { default_folder: dir, default_thinking_level: 'auto' } }) },
      );
      expect(resolve(session.cwd!).startsWith(resolve(dir))).toBe(true);
      expect(session.cwd).toContain(session.id);
    } finally {
      if (savedStateHome === undefined) delete process.env.MAESTRO_STATE_HOME;
      else process.env.MAESTRO_STATE_HOME = savedStateHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

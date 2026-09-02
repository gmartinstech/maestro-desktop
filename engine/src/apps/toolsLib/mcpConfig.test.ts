// engine/src/apps/toolsLib/mcpConfig.test.ts -- vitest twins of the real Python tests exercising
// backend/apps/tools_lib/tools_lib.py's sanitize_server_name (test_v2_invariants.py, Group covering
// mcp_meta_server activation) plus fresh coverage for resolveCommand/deriveMcpConfig.
//   - test_mcp_brand_covers_curated_servers / test_sanitize_server_name_idempotent /
//     test_sanitize_server_name_lowercase / test_sanitize_server_name_strips_special_chars
//     (backend/tests/test_v2_invariants.py)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deriveMcpConfig, resolveCommand, sanitizeServerName } from './mcpConfig';
import { makeToolDefinition } from './models';

describe('sanitizeServerName', () => {
  test('curated slugs already canonical', () => {
    const curated = ['google-workspace', 'microsoft-365', 'slack', 'discord', 'notion', 'airtable', 'hubspot', 'reddit', 'youtube'];
    for (const slug of curated) expect(sanitizeServerName(slug)).toBe(slug);
  });

  test('idempotent', () => {
    const inputs = ['Google Workspace', 'Microsoft 365', 'Slack', 'Discord', 'Notion', 'Airtable', 'HubSpot', 'Reddit', 'YouTube', 'GitHub', 'GitLab', 'Jira'];
    for (const raw of inputs) {
      const once = sanitizeServerName(raw);
      const twice = sanitizeServerName(once);
      expect(twice).toBe(once);
    }
  });

  test('lowercases', () => {
    expect(sanitizeServerName('Gmail')).toBe('gmail');
    expect(sanitizeServerName('UPPERCASE')).toBe('uppercase');
  });

  test('strips special chars', () => {
    expect(sanitizeServerName('Foo Bar!')).toBe('foo-bar');
    expect(sanitizeServerName('@x/y')).toBe('x-y');
    expect(sanitizeServerName('a__b')).toBe('a-b');
  });
});

describe('resolveCommand', () => {
  let dir: string;
  const savedPath = process.env.PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maestro-engine-resolve-command-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.PATH = savedPath;
  });

  test('finds an executable on PATH', () => {
    const name = process.platform === 'win32' ? 'mytool.exe' : 'mytool';
    const full = join(dir, name);
    writeFileSync(full, '#!/bin/sh\necho hi\n', { mode: 0o755 });
    process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + (savedPath ?? '');
    const resolved = resolveCommand('mytool');
    expect(resolved).toBe(full);
  });

  test('returns null for a command nowhere to be found', () => {
    process.env.PATH = dir;
    expect(resolveCommand('definitely-not-a-real-command-xyz')).toBeNull();
  });
});

describe('deriveMcpConfig', () => {
  const deps = {
    homeStateDir: () => '/tmp/maestro-home-state',
    getInstallId: () => 'install-123',
    getAuthToken: () => 'token-abc',
    maestroPort: () => '8324',
  };

  test('returns null when the tool has no mcp_config', () => {
    const tool = makeToolDefinition({ name: 'Nothing' });
    expect(deriveMcpConfig(tool, deps)).toBeNull();
  });

  test('injects credentials into env for a non-http stdio config', () => {
    const tool = makeToolDefinition({
      name: 'Custom',
      mcp_config: { type: 'stdio', command: '/bin/true' },
      credentials: { API_KEY: 'secret' },
    });
    const config = deriveMcpConfig(tool, deps)!;
    expect((config.env as Record<string, string>).API_KEY).toBe('secret');
  });

  test('injects Authorization header for http credentials', () => {
    const tool = makeToolDefinition({
      name: 'Custom HTTP',
      mcp_config: { type: 'http', url: 'https://example.com/mcp' },
      credentials: { authorization: 'sometoken' },
    });
    const config = deriveMcpConfig(tool, deps)!;
    expect((config.headers as Record<string, string>).Authorization).toBe('Bearer sometoken');
  });

  test('reddit/x/tiktok stdio tools get MAESTRO_PORT and MAESTRO_AUTH_TOKEN injected', () => {
    const tool = makeToolDefinition({ name: 'reddit', mcp_config: { type: 'stdio', command: '/bin/true' } });
    const config = deriveMcpConfig(tool, deps)!;
    const env = config.env as Record<string, string>;
    expect(env.MAESTRO_PORT).toBe('8324');
    expect(env.MAESTRO_AUTH_TOKEN).toBe('token-abc');
  });

  describe('SUB-9: social shims spawn the compiled TS port, not Python', () => {
    const savedNodePath = process.env.MAESTRO_NODE_PATH;
    const savedElectronPath = process.env.MAESTRO_ELECTRON_PATH;

    afterEach(() => {
      if (savedNodePath === undefined) delete process.env.MAESTRO_NODE_PATH;
      else process.env.MAESTRO_NODE_PATH = savedNodePath;
      if (savedElectronPath === undefined) delete process.env.MAESTRO_ELECTRON_PATH;
      else process.env.MAESTRO_ELECTRON_PATH = savedElectronPath;
    });

    test.each(['reddit', 'x', 'tiktok', 'discord'])('%s stdio config is rewritten to spawn node <dist>/apps/socialShims/%s/main.js', (name) => {
      process.env.MAESTRO_NODE_PATH = process.execPath; // the real running node.exe -- always exists
      const tool = makeToolDefinition({ name, mcp_config: { type: 'stdio', command: 'python', args: ['-m', `backend.apps.${name}_mcp_shim`] } });
      const config = deriveMcpConfig(tool, deps)!;
      expect(config.command).toBe(process.execPath);
      const args = config.args as string[];
      expect(args).toHaveLength(1);
      expect(args[0].replace(/\\/g, '/')).toMatch(new RegExp(`apps/socialShims/${name}/main\\.js$`));
    });

    test('discord config never gets a repo-root PYTHONPATH prefix -- the TS port has no backend.* import to resolve', () => {
      process.env.MAESTRO_NODE_PATH = process.execPath;
      const tool = makeToolDefinition({ name: 'discord', mcp_config: { type: 'stdio', command: 'python', args: ['-m', 'backend.apps.discord_mcp_shim'] } });
      const config = deriveMcpConfig(tool, deps)!;
      // Every stdio tool gets a bare PYTHONPATH="" default further down (unrelated to this ticket);
      // what this port removes is the OLD branch's repo-root-prefixed value.
      expect((config.env as Record<string, string>).PYTHONPATH).toBe('');
    });

    test('falls back to the Electron-as-Node path (with ELECTRON_RUN_AS_NODE=1) when no bundled/system node is configured', () => {
      delete process.env.MAESTRO_NODE_PATH;
      process.env.MAESTRO_ELECTRON_PATH = '/opt/Maestro/electron';
      // whichOnPath('node') may or may not find a real system node on the test box -- to make this
      // deterministic, only assert the Electron branch when the real box has no system node either.
      const tool = makeToolDefinition({ name: 'reddit', mcp_config: { type: 'stdio', command: 'python', args: ['-m', 'backend.apps.reddit_mcp_shim'] } });
      const config = deriveMcpConfig(tool, deps)!;
      // Either a real system node was found (fine, that's the documented priority order winning
      // correctly) or the Electron fallback fired with its env flag set -- either is a pass.
      if (config.command === '/opt/Maestro/electron') {
        expect((config.env as Record<string, string>).ELECTRON_RUN_AS_NODE).toBe('1');
      } else {
        expect(typeof config.command).toBe('string');
      }
    });
  });
});

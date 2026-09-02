import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { defaultAppSettings } from './models';
import { saveSettings } from './store';

// A settings write that changes credential/custom_providers fields schedules a real, fire-and-
// forget background sync against whatever 9Router this machine has listening on port 20128 (see
// handler.ts's own scheduleNineRouterSync). On this repo's shared dev box that's a REAL,
// already-running process the user depends on -- letting these tests reach it would mutate its
// live provider config with test-only garbage tokens (confirmed empirically before adding this
// mock: the suite logged "9Router: updated custom node cp-maestro"). Mocked at the module level
// (not via a deps parameter -- handleSettingsHttpRequest has none, matching every other partial-
// native handler's fixed signature) so every test in this file is fully hermetic regardless of
// what's actually running on this box. loopback.ts's own `isRunning` check (used by the
// maestro/login/start route below) shares this same mock, which is also why that route never
// tries to bind the real port 20128 listener during these tests (it sees "9Router is already up"
// and skips straight to the no-op branch).
vi.mock('../router/process', () => ({
  isRunning: vi.fn(async () => true),
  ensureRunning: vi.fn(async () => undefined),
}));
vi.mock('../router/sync', () => ({
  syncGeminiApiKey: vi.fn(async () => undefined),
  syncOpenaiApiKey: vi.fn(async () => undefined),
  syncOpenrouterApiKey: vi.fn(async () => undefined),
  syncCustomProviders: vi.fn(async () => undefined),
}));

import { handleSettingsHttpRequest } from './handler';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;
// SUB-10's applyMaestroDefaults() (wired into GET/PUT/PATCH by this ticket) reads
// process.env.PROVEDOR_IA_TOKEN, and a settings write whose custom_providers/credential fields
// changed schedules a REAL, fire-and-forget background sync against whatever 9Router this machine
// already has listening on 20128. This repo's own real dev shell profile sets a genuine
// PROVEDOR_IA_TOKEN (confirmed empirically: leaving it in place made this exact suite log "9Router:
// updated custom node cp-maestro" -- a live mutation of the user's own already-running 9Router,
// exactly the kind of shared-box side effect CLAUDE.md/the ticket's own constraints warn against
// for the 9Router *process* itself). Unset for the lifetime of this file so every test here is
// hermetic; the token's own presence/absence is exercised deliberately and explicitly by the
// "applyMaestroDefaults" describe block near the bottom instead, with the background sync's
// network leg confirmed unreachable there (localhost:1 -- see that block's own comment).
let savedProvedorIaToken: string | undefined;

beforeAll(async () => {
  savedProvedorIaToken = process.env.PROVEDOR_IA_TOKEN;
  delete process.env.PROVEDOR_IA_TOKEN;
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-settings-handler-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleSettingsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  rmSync(join(dataRoot, 'settings'), { recursive: true, force: true });
});

afterAll(async () => {
  await fastify.close();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  if (savedProvedorIaToken !== undefined) process.env.PROVEDOR_IA_TOKEN = savedProvedorIaToken;
});

describe('GET /api/settings', () => {
  test('returns defaults when nothing is stored yet, with no token so default_model falls back off the unreachable Maestro entry', async () => {
    // SUB-10 wires applyMaestroDefaults() into this GET (matching Python's own store.load_settings,
    // which runs it on every load) -- with no provedor_ia_token AND no PROVEDOR_IA_TOKEN env var
    // (this file's own beforeAll deletes it for the whole suite), a fresh install's shipped
    // default_model (MAESTRO_DEFAULT_MODEL) names a picker entry that can't exist yet, so it
    // correctly demotes to FALLBACK_DEFAULT_MODEL ('sonnet') -- this is the real, intended
    // behavior a genuinely tokenless first launch produces, not a regression of the pre-SUB-10
    // "just echo whatever's on disk" assertion this test previously made.
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { default_model: string };
    expect(body.default_model).toBe('sonnet');
  });
});

describe('PUT /api/settings', () => {
  test('persists a full object and returns it', async () => {
    const payload = { ...defaultAppSettings(), theme: 'dark', provedor_ia_token: 'mtok_x' };
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; settings: { theme: string; provedor_ia_token: string } };
    expect(body.ok).toBe(true);
    expect(body.settings.theme).toBe('dark');
    expect(body.settings.provedor_ia_token).toBe('mtok_x');

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const getBody = (await getRes.json()) as { theme: string };
    expect(getBody.theme).toBe('dark');
  });

  test('a server-owned field cannot be forged by a client PUT', async () => {
    saveSettings({ ...defaultAppSettings(), user_id: 'real-server-issued-id' });
    const forged = { ...defaultAppSettings(), user_id: 'attacker-supplied-id' };
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forged),
    });
    const body = (await res.json()) as { settings: { user_id: string } };
    expect(body.settings.user_id).toBe('real-server-issued-id');
  });

  test('a non-object body is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/settings', () => {
  test('merges only the sent fields onto current state', async () => {
    saveSettings({ ...defaultAppSettings(), theme: 'dark', browser_homepage: 'https://example.com' });
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'light' }),
    });
    const body = (await res.json()) as { settings: { theme: string; browser_homepage: string } };
    expect(body.settings.theme).toBe('light');
    expect(body.settings.browser_homepage).toBe('https://example.com');
  });
});

describe('unhandled paths', () => {
  test('a different top-level route sharing the "settings" string prefix is NOT swallowed', async () => {
    // '/api/settings-meta/...' is a DIFFERENT route name in split.ts's table (server.ts never even
    // dispatches it here) -- this guards the exact-segment check at the top of
    // handleSettingsHttpRequest against regressing to a loose startsWith('/api/settings').
    const res = await fetch(`${baseUrl}/api/settings-meta/read`, { method: 'POST' });
    expect(res.status).toBe(404); // this test server's own fallback, proving handleSettingsHttpRequest returned false
  });
});

describe('GET /api/settings/maestro/token-status', () => {
  test('reports missing when nothing is stored', async () => {
    const res = await fetch(`${baseUrl}/api/settings/maestro/token-status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('missing');
  });
});

describe('POST /api/settings/maestro/login/start', () => {
  test('mints a Keycloak authorize URL with a state param', async () => {
    const res = await fetch(`${baseUrl}/api/settings/maestro/login/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorize_url: string };
    expect(body.authorize_url).toContain('https://martinstech.net/auth/realms/MartinsTech');
    expect(body.authorize_url).toContain('state=');
    expect(body.authorize_url).toContain('code_challenge=');
  });
});

describe('GET/PUT /api/settings/app-theme-override', () => {
  test('defaults to null, then round-trips a valid value', async () => {
    const getRes = await fetch(`${baseUrl}/api/settings/app-theme-override`);
    expect((await getRes.json()) as { mode: string | null }).toEqual({ mode: null });

    const putRes = await fetch(`${baseUrl}/api/settings/app-theme-override`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'dark' }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { ok: boolean; mode: string };
    expect(putBody).toEqual({ ok: true, mode: 'dark' });

    const getAfter = await fetch(`${baseUrl}/api/settings/app-theme-override`);
    expect((await getAfter.json()) as { mode: string }).toEqual({ mode: 'dark' });
  });

  test('an invalid mode is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/settings/app-theme-override`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'blue' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/settings/dismiss-mcp-suggestion', () => {
  test('stamps every listed id with a timestamp', async () => {
    const res = await fetch(`${baseUrl}/api/settings/dismiss-mcp-suggestion`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['gmail', 'slack'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { dismissed_mcp_suggestions: Record<string, string> } };
    expect(Object.keys(body.settings.dismissed_mcp_suggestions).sort()).toEqual(['gmail', 'slack']);
  });
});

describe('default-system-prompt / reset routes', () => {
  test('GET default-system-prompt returns the shipped constant', async () => {
    const res = await fetch(`${baseUrl}/api/settings/default-system-prompt`);
    const body = (await res.json()) as { default_system_prompt: string };
    expect(body.default_system_prompt.length).toBeGreaterThan(0);
  });

  test('reset-system-prompt restores it after a custom prompt was saved', async () => {
    saveSettings({ ...defaultAppSettings(), default_system_prompt: 'custom prompt' });
    const res = await fetch(`${baseUrl}/api/settings/reset-system-prompt`, { method: 'POST' });
    const body = (await res.json()) as { settings: { default_system_prompt: string } };
    expect(body.settings.default_system_prompt).not.toBe('custom prompt');
  });

  test('reset-to-defaults preserves credentials/identity but resets everything else', async () => {
    saveSettings({
      ...defaultAppSettings(),
      theme: 'dark',
      anthropic_api_key: 'sk-ant-keep-me',
      user_name: 'Keep Me',
    });
    const res = await fetch(`${baseUrl}/api/settings/reset-to-defaults`, { method: 'POST' });
    const body = (await res.json()) as { settings: { theme: string; anthropic_api_key: string; user_name: string } };
    expect(body.settings.theme).toBe(defaultAppSettings().theme);
    expect(body.settings.anthropic_api_key).toBe('sk-ant-keep-me');
    expect(body.settings.user_name).toBe('Keep Me');
  });
});

describe('GET /api/settings/browse-directories', () => {
  test('lists the OS temp directory without throwing', async () => {
    const res = await fetch(`${baseUrl}/api/settings/browse-directories?path=${encodeURIComponent(tmpdir())}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { current: string; directories: string[]; files: string[] };
    expect(body.current).toBeTruthy();
    expect(Array.isArray(body.directories)).toBe(true);
    expect(Array.isArray(body.files)).toBe(true);
  });

  test('a nonexistent path is a 404', async () => {
    const res = await fetch(`${baseUrl}/api/settings/browse-directories?path=${encodeURIComponent(join(tmpdir(), 'definitely-does-not-exist-xyz'))}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/settings/upload-files', () => {
  test('accepts a multipart body with a repeated "files" field and returns per-file metadata', async () => {
    // Randomized filenames: UPLOAD_DIR is the REAL OS temp dir (shared across test runs, not
    // scoped to this suite's per-test dataRoot), so a fixed name would collide with a leftover
    // file from a previous run and silently get the collision-retry's `_1` suffix instead of the
    // name this test actually asked for.
    const tag = randomUUID().slice(0, 8);
    const nameA = `hello-${tag}.txt`;
    const nameB = `two-${tag}.txt`;
    const boundary = '----maestroTestBoundary';
    const bodyText =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${nameA}"\r\n` +
      'Content-Type: text/plain\r\n\r\n' +
      'hello world\r\n' +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${nameB}"\r\n` +
      'Content-Type: text/plain\r\n\r\n' +
      'a second file\r\n' +
      `--${boundary}--\r\n`;
    const res = await fetch(`${baseUrl}/api/settings/upload-files`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: bodyText,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string; name: string; kind: string; tokens: number }[] };
    try {
      expect(body.files).toHaveLength(2);
      expect(body.files.map((f) => f.name).sort()).toEqual([nameA, nameB].sort());
      expect(body.files.every((f) => f.kind === 'text')).toBe(true);
    } finally {
      for (const f of body.files) {
        try { unlinkSync(f.path); } catch { /* best-effort test cleanup */ }
      }
    }
  });
});

describe('POST /api/settings/summarize-file', () => {
  test('a missing file is a 404', async () => {
    const res = await fetch(`${baseUrl}/api/settings/summarize-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: join(tmpdir(), 'maestro-uploads', 'nope.txt') }),
    });
    expect(res.status).toBe(404);
  });
});

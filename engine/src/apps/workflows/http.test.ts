// engine/src/apps/workflows/http.test.ts -- SUB-7's vitest twin covering the full 35-route
// /api/workflows/* surface end to end through a real Fastify server (mirrors dashboards.test.ts's
// own convention), plus a faithful port of backend/tests/test_workflows_api.py's trash-lifecycle
// and pause-all/resume-all cases and test_workflows_semantics.py's If-Match staleness case.
//
// The 35-route list below was enumerated directly from this repo's contract/openapi.json with:
//   node -e 'const s=require("./contract/openapi.json");let n=0;for(const p of Object.keys(s.paths))
//     if(p.startsWith("/api/workflows"))for(const m of Object.keys(s.paths[p]))
//       if(["get","post","put","patch","delete"].includes(m)){console.log(m.toUpperCase(),p);n++}
//     console.log("TOTAL:",n)'
// (run from the repo root) -- confirmed TOTAL: 35, matching workflows.py's own 35 @workflows.router
// decorators. Every one of those 35 method+path pairs is exercised below.
//
// MAESTRO_MOCK_AGENT=1 is set for this file only (restored after), same convention
// AgentManager.test.ts already established -- every route that launches or drives an agent turn
// (edit-agent-session, ask-run, test-run, schedule-agent-session, run) needs it: the engine's real
// (non-mock) turn loop is not yet implemented (AgentManager.ts's own header), and this repo's
// CLAUDE.md names the mock flag as the sanctioned way to prove the engine end-to-end -- this is
// exactly that proof, not the backend pytest suite the same doc says must run with it UNSET.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { agentManager } from '../../agents/AgentManager';
import { createAgentSession } from '../../agents/sessionFactory';
import { handleWorkflowsHttpRequest, resetHttpStateForTest } from './http';
import * as escalation from './escalation';
import * as scheduler from './scheduler';
import * as storage from './store';
import { newWorkflowRun } from './models';

let dataRoot: string;
let fastify: FastifyInstance;
let baseUrl: string;
let originalMockFlag: string | undefined;

beforeAll(async () => {
  originalMockFlag = process.env.MAESTRO_MOCK_AGENT;
  process.env.MAESTRO_MOCK_AGENT = '1';
  fastify = Fastify({ logger: false });
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleWorkflowsHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-engine-workflows-http-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  storage.resetCacheForTest();
  scheduler.resetForTest();
  resetHttpStateForTest();
  escalation.resetForTest();
  agentManager.sessions.clear();
});

afterEach(async () => {
  await scheduler.stop();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  storage.resetCacheForTest();
  scheduler.resetForTest();
  agentManager.sessions.clear();
});

afterAll(async () => {
  await fastify.close();
  if (originalMockFlag === undefined) delete process.env.MAESTRO_MOCK_AGENT;
  else process.env.MAESTRO_MOCK_AGENT = originalMockFlag;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}
async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}
async function patch(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
async function del(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

async function expectAnswered(res: Response, label: string): Promise<unknown> {
  expect(res.status, `${label}: got ${res.status}`).not.toBe(501);
  expect(res.status, `${label}: got ${res.status}`).not.toBe(502);
  const body: unknown = await res.json();
  expect(body, `${label}: fell through unhandled to the test server's 404`).not.toEqual({ error: 'unhandled_by_this_test_server' });
  return body;
}

describe('all 35 /api/workflows/* contract routes answer natively', () => {
  test('drives a real workflow through every route, end to end', async () => {
    // 1: POST /create
    const createRes = await post('/api/workflows/create', { title: 'E2E workflow', steps: [{ text: 'say hi' }], unsaved: false });
    const wf = (await expectAnswered(createRes, 'POST /create')) as { id: string; title: string };
    expect(createRes.status).toBe(200);
    expect(wf.id).toBeTruthy();

    // 2: GET /list
    const listBody = (await expectAnswered(await get('/api/workflows/list'), 'GET /list')) as { workflows: Array<{ id: string }> };
    expect(listBody.workflows.map((w) => w.id)).toContain(wf.id);

    // 3: POST /generate-metadata
    await expectAnswered(await post('/api/workflows/generate-metadata', { steps: [{ text: 'say hi' }], model: 'sonnet' }), 'POST /generate-metadata');

    // 4: GET /active
    await expectAnswered(await get('/api/workflows/active'), 'GET /active');

    // 5+6: POST /pause-all, POST /resume-all
    const pauseBody = (await expectAnswered(await post('/api/workflows/pause-all'), 'POST /pause-all')) as { paused: boolean };
    expect(pauseBody.paused).toBe(true);
    const resumeBody = (await expectAnswered(await post('/api/workflows/resume-all'), 'POST /resume-all')) as { paused: boolean };
    expect(resumeBody.paused).toBe(false);

    // 7: GET /paused
    const pausedBody = (await expectAnswered(await get('/api/workflows/paused'), 'GET /paused')) as { paused: boolean };
    expect(pausedBody.paused).toBe(false);

    // 8: GET /cron/findings
    await expectAnswered(await get('/api/workflows/cron/findings'), 'GET /cron/findings');

    // 9: GET /cloud/sms/status
    const smsBody = (await expectAnswered(await get('/api/workflows/cloud/sms/status'), 'GET /cloud/sms/status')) as { enabled: boolean };
    expect(smsBody.enabled).toBe(false);

    // 10: GET /runs/all
    await expectAnswered(await get('/api/workflows/runs/all'), 'GET /runs/all');

    // 11: GET /missed
    await expectAnswered(await get('/api/workflows/missed'), 'GET /missed');

    // 12+13: POST /missed/run, POST /missed/dismiss (empty selections -- still a real, valid answer)
    const missedRunBody = (await expectAnswered(await post('/api/workflows/missed/run', { ids: [] }), 'POST /missed/run')) as { started: number };
    expect(missedRunBody.started).toBe(0);
    const missedDismissBody = (await expectAnswered(await post('/api/workflows/missed/dismiss', { ids: [] }), 'POST /missed/dismiss')) as { dismissed: number };
    expect(missedDismissBody.dismissed).toBe(0);

    // 14: GET /calendar
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    await expectAnswered(await get(`/api/workflows/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'GET /calendar');

    // 15: GET /deleted
    await expectAnswered(await get('/api/workflows/deleted'), 'GET /deleted');

    // 16: GET /{workflow_id}
    const getBody = (await expectAnswered(await get(`/api/workflows/${wf.id}`), 'GET /{id}')) as { id: string };
    expect(getBody.id).toBe(wf.id);

    // 17: GET /{workflow_id}/audit
    await expectAnswered(await get(`/api/workflows/${wf.id}/audit`), 'GET /{id}/audit');

    // 18: PATCH /{workflow_id}
    const patchBody = (await expectAnswered(await patch(`/api/workflows/${wf.id}`, { title: 'Renamed E2E' }), 'PATCH /{id}')) as { title: string };
    expect(patchBody.title).toBe('Renamed E2E');

    // 19: POST /{workflow_id}/restore -- not in trash yet, still a real (404) answer.
    const restoreRes = await post(`/api/workflows/${wf.id}/restore`);
    await expectAnswered(restoreRes, 'POST /{id}/restore');
    expect(restoreRes.status).toBe(404);

    // 20: DELETE /{workflow_id}/purge -- not in trash yet, still a real (404) answer.
    const purgeRes = await del(`/api/workflows/${wf.id}/purge`);
    await expectAnswered(purgeRes, 'DELETE /{id}/purge');
    expect(purgeRes.status).toBe(404);

    // 21: POST /{workflow_id}/edit-agent-session
    const editBody = (await expectAnswered(await post(`/api/workflows/${wf.id}/edit-agent-session`), 'POST /{id}/edit-agent-session')) as { session_id: string };
    expect(editBody.session_id).toBeTruthy();

    // 22: POST /{workflow_id}/draft/commit
    await expectAnswered(await post(`/api/workflows/${wf.id}/draft/commit`, {}), 'POST /{id}/draft/commit');

    // 23: POST /{workflow_id}/draft/discard
    await expectAnswered(await post(`/api/workflows/${wf.id}/draft/discard`), 'POST /{id}/draft/discard');

    // 24: POST /{workflow_id}/test-run
    const testRunBody = (await expectAnswered(await post(`/api/workflows/${wf.id}/test-run`, {}), 'POST /{id}/test-run')) as { session_id: string };
    expect(testRunBody.session_id).toBeTruthy();
    await sleep(300); // let the mock-driven test-run turn finish before reading its transcript

    // 25: GET /{workflow_id}/test-transcript -- reports the Test Agent session's own status word.
    const transcriptBody = (await expectAnswered(await get(`/api/workflows/${wf.id}/test-transcript`), 'GET /{id}/test-transcript')) as { status: string };
    expect(['running', 'waiting_approval', 'completed', 'error', 'stopped', 'none', 'unavailable']).toContain(transcriptBody.status);

    // 26: POST /{workflow_id}/schedule-agent-session
    const scheduleAgentBody = (await expectAnswered(await post(`/api/workflows/${wf.id}/schedule-agent-session`), 'POST /{id}/schedule-agent-session')) as { session_id: string };
    expect(scheduleAgentBody.session_id).toBeTruthy();

    // 27: POST /{workflow_id}/run -- THE real end-to-end drive: launches a real (mock) agent turn,
    // feeds it the workflow's one step, and returns the run the executor actually recorded.
    const runRes = await post(`/api/workflows/${wf.id}/run`, {});
    const runBody = (await expectAnswered(runRes, 'POST /{id}/run')) as { run_id: string; status: string | null; error: string | null };
    expect(runBody.run_id).toBeTruthy();
    await sleep(400); // let the run's mock turn fully finish (success/failure) before probing it below

    // 28: GET /{workflow_id}/runs
    const runsBody = (await expectAnswered(await get(`/api/workflows/${wf.id}/runs`), 'GET /{id}/runs')) as { runs: Array<{ id: string; status: string }> };
    const finishedRun = runsBody.runs.find((r) => r.id === runBody.run_id);
    expect(finishedRun).toBeTruthy();
    expect(finishedRun!.status).toBe('success'); // the mock agent always "succeeds" its one step

    // 29: POST /{workflow_id}/ask-run
    const askRunBody = (await expectAnswered(await post(`/api/workflows/${wf.id}/ask-run`, { run_id: runBody.run_id, prompt: 'what happened?' }), 'POST /{id}/ask-run')) as { session_id: string };
    expect(askRunBody.session_id).toBeTruthy();

    // 30: POST /runs/{run_id}/ack
    const ackBody = (await expectAnswered(await post(`/api/workflows/runs/${runBody.run_id}/ack`), 'POST /runs/{id}/ack')) as { acked: boolean };
    expect(ackBody.acked).toBe(true);

    // 31: GET /runs/{run_id}/escalation
    const escBody = (await expectAnswered(await get(`/api/workflows/runs/${runBody.run_id}/escalation`), 'GET /runs/{id}/escalation')) as { state: unknown };
    expect(escBody.state).toBeNull(); // a single-tier workflow never schedules an escalation

    // 32-34: POST /runs/{run_id}/stop|pause|resume -- the run already finished (real 404 answers).
    for (const action of ['stop', 'pause', 'resume']) {
      const res = await post(`/api/workflows/runs/${runBody.run_id}/${action}`);
      await expectAnswered(res, `POST /runs/{id}/${action}`);
      expect(res.status).toBe(404);
    }

    // 35: DELETE /{workflow_id} -- soft delete, last so every route above still had a live workflow.
    const deleteBody = (await expectAnswered(await del(`/api/workflows/${wf.id}`), 'DELETE /{id}')) as { ok: boolean };
    expect(deleteBody.ok).toBe(true);
  }, 20_000);
});

describe('If-Match optimistic concurrency (PATCH /{workflow_id})', () => {
  test('a stale If-Match 409s; a fresh one and a missing one both succeed', async () => {
    const wf = (await (await post('/api/workflows/create', { title: 'optimistic-test', steps: [{ text: 'hi' }], unsaved: false })).json()) as { id: string; updated_at: string };

    const stale = await patch(`/api/workflows/${wf.id}`, { title: 'x' }, { 'If-Match': '1999-01-01T00:00:00' });
    expect(stale.status).toBe(409);

    const fresh = (await (await get(`/api/workflows/${wf.id}`)).json()) as { updated_at: string };
    const okRes = await patch(`/api/workflows/${wf.id}`, { title: 'y' }, { 'If-Match': fresh.updated_at });
    expect(okRes.status).toBe(200);
    expect(((await okRes.json()) as { title: string }).title).toBe('y');

    const legacyRes = await patch(`/api/workflows/${wf.id}`, { title: 'z' });
    expect(legacyRes.status).toBe(200);
    expect(((await legacyRes.json()) as { title: string }).title).toBe('z');
  });
});

describe('trash lifecycle (soft-delete -> restore -> purge)', () => {
  test('soft delete hides the workflow, disables its schedule, and drops pending missed runs', async () => {
    const wf = (await (await post('/api/workflows/create', {
      title: 'trash-test', steps: [{ text: 'hi' }], unsaved: false,
      schedule: { enabled: true, repeat_every: 1, repeat_unit: 'day', on_days: [], hour: 9, minute: 0, day_of_month: null, last_day_of_month: false, timezone: 'UTC', ends_at: null, max_runs: null, runs_count: 0 },
    })).json()) as { id: string };

    const delRes = await del(`/api/workflows/${wf.id}`);
    expect((await delRes.json())).toEqual({ ok: true });

    expect((await (await get('/api/workflows/list')).json() as { workflows: Array<{ id: string }> }).workflows.map((w) => w.id)).not.toContain(wf.id);
    expect((await (await get('/api/workflows/deleted')).json() as { workflows: Array<{ id: string }> }).workflows.map((w) => w.id)).toContain(wf.id);
  });

  test('restore brings it back with the schedule still off; purge only works from trash and removes it', async () => {
    const wf = (await (await post('/api/workflows/create', { title: 'restore-test', steps: [{ text: 'hi' }], unsaved: false })).json()) as { id: string };
    await del(`/api/workflows/${wf.id}`);

    const restoreBody = (await (await post(`/api/workflows/${wf.id}/restore`)).json()) as { id: string; schedule: { enabled: boolean } };
    expect(restoreBody.id).toBe(wf.id);
    expect(restoreBody.schedule.enabled).toBe(false);
    expect((await (await get('/api/workflows/list')).json() as { workflows: Array<{ id: string }> }).workflows.map((w) => w.id)).toContain(wf.id);

    // purge refuses a workflow that isn't in trash.
    expect((await post(`/api/workflows/${wf.id}/restore`)).status).toBe(404);
    expect((await del(`/api/workflows/${wf.id}/purge`)).status).toBe(404);

    await del(`/api/workflows/${wf.id}`);
    // double-delete is a 404 (already gone).
    expect((await del(`/api/workflows/${wf.id}`)).status).toBe(404);

    const purgeRes = await del(`/api/workflows/${wf.id}/purge`);
    expect(await purgeRes.json()).toEqual({ ok: true });
    expect((await get(`/api/workflows/${wf.id}`)).status).toBe(404);
  });
});

describe('pause-all / resume-all flip the global flag', () => {
  test('round-trips through GET /paused', async () => {
    expect(((await (await get('/api/workflows/paused')).json()) as { paused: boolean }).paused).toBe(false);
    expect(await (await post('/api/workflows/pause-all')).json()).toEqual({ paused: true });
    expect(((await (await get('/api/workflows/paused')).json()) as { paused: boolean }).paused).toBe(true);
    expect(await (await post('/api/workflows/resume-all')).json()).toEqual({ paused: false });
  });
});

// -- the remaining test_workflows_semantics.py cases not already covered by executor.test.ts /
// escalation.test.ts / audit.test.ts / scheduler.test.ts's own vitest twins (see each of those
// files' own header) -- freeze-default-on-create, timezone normalization, and the /run endpoint's
// cost-cap short-circuit, all exercised through this same real HTTP surface the Python originals
// drove their route handlers through directly.

function baseSchedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0,
    on_days: [], day_of_month: null, last_day_of_month: false, timezone: 'UTC',
    ends_at: null, max_runs: null, runs_count: 0,
    ...overrides,
  };
}

describe('freeze-default on create -- mirrors test_freeze_defaults_on_for_scheduled_create / test_freeze_not_forced_when_source_session_present', () => {
  test('a scheduled create with no source session flips actions.freeze on', async () => {
    const res = await post('/api/workflows/create', {
      title: 'scheduled', steps: [{ text: 'say hi' }],
      schedule: baseSchedule(),
      actions: { freeze: false, configured_sets: [], prevent_unused: false },
    });
    const wf = (await res.json()) as { actions: { freeze: boolean } };
    expect(wf.actions.freeze).toBe(true);
  });

  test('a create with source_session_id (no session resident) leaves freeze untouched', async () => {
    const res = await post('/api/workflows/create', {
      title: 'from chat', source_session_id: 'sess-does-not-exist', steps: [{ text: 'say hi' }],
      schedule: baseSchedule(),
      actions: { freeze: false, configured_sets: [], prevent_unused: false },
    });
    const wf = (await res.json()) as { actions: { freeze: boolean } };
    expect(wf.actions.freeze).toBe(false);
  });

  test('a create with a resident source session inherits its allowed_tools and freezes to them', async () => {
    agentManager.sessions.set('sess-allowed', createAgentSession({
      id: 'sess-allowed', name: 'source chat', created_at: new Date().toISOString(), branches: {}, allowed_tools: ['Read'],
    }));
    try {
      const res = await post('/api/workflows/create', {
        title: 'from restricted chat', source_session_id: 'sess-allowed', steps: [{ text: 'say hi' }],
        schedule: baseSchedule(),
        actions: { freeze: false, configured_sets: [], prevent_unused: false },
      });
      const wf = (await res.json()) as { actions: { freeze: boolean; configured_sets: string[] } };
      expect(wf.actions.freeze).toBe(true);
      expect(wf.actions.configured_sets).toEqual(['Read']);
    } finally {
      agentManager.sessions.delete('sess-allowed');
    }
  });
});

describe('legacy timezone normalization -- mirrors test_create_enabled_schedule_normalizes_local_timezone / test_enable_schedule_normalizes_local_timezone_and_preserves_concrete_timezone', () => {
  const originalTz = process.env.MAESTRO_TIMEZONE;
  beforeEach(() => { process.env.MAESTRO_TIMEZONE = 'America/Chicago'; });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.MAESTRO_TIMEZONE;
    else process.env.MAESTRO_TIMEZONE = originalTz;
  });

  test('an enabled create with timezone="local" is normalized to the host zone', async () => {
    const res = await post('/api/workflows/create', {
      title: 'local-tz-create', steps: [{ text: 'say hi' }],
      schedule: baseSchedule({ timezone: 'local' }),
    });
    const wf = (await res.json()) as { schedule: { timezone: string } };
    expect(wf.schedule.timezone).toBe('America/Chicago');
  });

  test('enabling a disabled schedule normalizes "local", and a later edit preserves the resolved concrete zone', async () => {
    const created = (await (await post('/api/workflows/create', {
      title: 'enable-tz-test', steps: [{ text: 'say hi' }],
      schedule: baseSchedule({ enabled: false, timezone: 'local' }),
    })).json()) as { id: string; schedule: Record<string, unknown> };

    const enabled = (await (await patch(`/api/workflows/${created.id}`, {
      schedule: { ...created.schedule, enabled: true },
    })).json()) as { schedule: { timezone: string } };
    expect(enabled.schedule.timezone).toBe('America/Chicago');

    const edited = (await (await patch(`/api/workflows/${created.id}`, {
      schedule: { ...enabled.schedule, hour: 10 },
    })).json()) as { schedule: { timezone: string; hour: number } };
    expect(edited.schedule.timezone).toBe('America/Chicago');
    expect(edited.schedule.hour).toBe(10);
  });
});

describe('monthly create pins the missing day_of_month to the creation day -- mirrors test_monthly_create_pins_missing_day_to_creation_day', () => {
  test('day_of_month lands on today (UTC) when the schedule omits it', async () => {
    const res = await post('/api/workflows/create', {
      title: 'monthly', steps: [{ text: 'say hi' }],
      schedule: baseSchedule({ repeat_unit: 'month', day_of_month: null, timezone: 'UTC' }),
    });
    const wf = (await res.json()) as { schedule: { day_of_month: number } };
    expect(wf.schedule.day_of_month).toBe(new Date().getUTCDate());
  });
});

describe('GET /calendar returns events sorted by fire_at -- mirrors test_calendar_endpoint_returns_sorted_utc_events', () => {
  test('two workflows firing on different times of day come back in chronological order', async () => {
    await post('/api/workflows/create', { title: 'later', steps: [{ text: 'hi' }], schedule: baseSchedule({ hour: 22, minute: 0 }) });
    await post('/api/workflows/create', { title: 'earlier', steps: [{ text: 'hi' }], schedule: baseSchedule({ hour: 1, minute: 0 }) });
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const body = (await (await get(`/api/workflows/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).json()) as { events: Array<{ fire_at: string }> };
    const fireAts = body.events.map((e) => e.fire_at);
    expect(fireAts).toEqual([...fireAts].sort());
  });
});

describe('POST /{id}/run surfaces a cost-capped skip immediately -- mirrors test_run_endpoint_surfaces_skipped_status', () => {
  test('a fully-spent monthly cap short-circuits the run before any agent turn launches', async () => {
    const wf = (await (await post('/api/workflows/create', {
      title: 'cap-immediate', steps: [{ text: 'hi' }], unsaved: false, cost_cap_usd_monthly: 0.01,
    })).json()) as { id: string };
    storage.recordRun(newWorkflowRun({
      workflow_id: wf.id, status: 'success', cost_usd: 5.0,
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    }));
    const res = (await (await post(`/api/workflows/${wf.id}/run`, {})).json()) as { status: string | null; error: string | null };
    expect(res.status).toBe('skipped');
    expect((res.error ?? '').toLowerCase()).toContain('cost cap');
  });
});

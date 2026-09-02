// engine/src/apps/swarm/closure.test.ts -- SUB-3, vitest twin of backend/tests/
// test_swarm_bundle.py -- the full export/import round-trip, manifest validation, checksum
// tampering, and rollback cases (redaction and zip-hardening have their own dedicated files:
// redact.test.ts, ziputil.test.ts).
//
// test_app_export_drops_machine_env is ported for real below (SUB-5 landed a real AppExportable,
// see appExportable.ts's own header) -- it is no longer a scope cut.
//
// DELIBERATE, DOCUMENTED SCOPE CUTS (not ported, each for a concrete reason):
//   - test_workflow_round_trips_through_the_store: the Python original needs a real, persisted
//     workflow store; workflowExportable.ts is a documented stand-in until SUB-7 lands one. Ported
//     here INSTEAD as a test of the actual documented stub behavior (load() -> null, import_() ->
//     throws) so the scope cut is proven, not just asserted in a comment.
//   - test_get_all_sessions_does_not_resurrect_deleted_cards: exercises
//     agent_manager.get_all_sessions's own dashboard-layout cross-check, which is AGT territory
//     (AgentManager.ts's getAllSessions doesn't do this cross-check either -- a pre-existing,
//     separately-owned gap, not something this ticket's files touch).

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agentManager } from '../../agents/AgentManager';
import { createAgentSession, createMessage, createMessageBranch } from '../../agents/sessionFactory';
import { loadSessionData, saveSessionFile } from '../../agents/manager/session/sessionFileStore';
import { loadIndex, resetSkillsDirForTests, saveIndex, setSkillsDirForTests, skillsDir } from '../skills/skills';
import { SkillExportable } from '../skills/swarmSkillEntity';
import { load as loadDashboard, save as saveDashboard } from '../dashboards/store';
import type { Dashboard } from '../dashboards/models';
import { hydrateOutput } from '../outputs/models';
import { outputsWorkspaceDir } from '../outputs/paths';
import { save as saveOutput } from '../outputs/workspaceIo';
import {
  buildBundle,
  commit,
  parseManifest,
  stageUpload,
  validateManifest,
  type StagedBundle,
} from './closure';
import { AppExportable } from './entities/appExportable';
import { DashboardExportable } from './entities/dashboardExportable';
import { SessionExportable } from './entities/sessionExportable';
import { sanitizeWorkflow, WorkflowExportable } from './entities/workflowExportable';
import { RemapTable, type ExportContext } from './exportable';
import { EntityType, type BundlePreview, type EntityRef, type Manifest } from './models';
import { scrubPayload } from './redact';
import { BundleError } from './ziputil';

let skillDir: string;
let dataRoot: string;

const nullCtx: ExportContext = { bundleIdFor: () => null };

beforeEach(() => {
  skillDir = mkdtempSync(join(tmpdir(), 'maestro-swarm-skills-test-'));
  setSkillsDirForTests(skillDir);
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-swarm-data-test-'));
  process.env.MAESTRO_DATA_ROOT = dataRoot;
  agentManager.sessions.clear();
});

afterEach(() => {
  resetSkillsDirForTests();
  rmSync(skillDir, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.MAESTRO_DATA_ROOT;
  agentManager.sessions.clear();
});

function makeSkill(slug: string, name: string, content: string, description = 'desc'): void {
  writeFileSync(join(skillsDir(), `${slug}.md`), content, 'utf8');
  const index = loadIndex();
  index[slug] = { name, description, command: slug };
  saveIndex(index);
}

async function discard(staged: StagedBundle): Promise<void> {
  rmSync(staged.sandbox, { recursive: true, force: true });
}

function emptyDashboardLayout(): Dashboard['layout'] {
  return { cards: {}, view_cards: {}, browser_cards: {}, workflow_cards: {}, workflows_hub: null, notes: {}, expanded_session_ids: [] };
}

// ---------- skill round trip ----------

describe('skill export/import round trip', () => {
  test('exports and re-imports under a fresh, non-clobbering slug', async () => {
    makeSkill('my-skill', 'My Skill', '# hello\nbody text');
    const { raw, rootName } = await buildBundle(EntityType.skill, 'my-skill');
    expect(rootName).toBe('My Skill');
    const zip = await JSZip.loadAsync(raw);
    expect(zip.file('manifest.json')).toBeTruthy();

    const staged = await stageUpload(raw, 'My Skill.swarm');
    try {
      expect(staged.manifest.root.type).toBe(EntityType.skill);
      const { rootType, rootId, created } = commit(staged.sandbox, staged.manifest, []);
      expect(rootType).toBe(EntityType.skill);
      expect(rootId).not.toBe('my-skill');
      expect(existsSync(join(skillsDir(), 'my-skill.md'))).toBe(true); // original untouched
      expect(readFileSync(join(skillsDir(), rootId!, 'SKILL.md'), 'utf8')).toBe('# hello\nbody text');
      expect(created).toEqual({ skill: [rootId] });
    } finally {
      await discard(staged);
    }
  });

  test('bare markdown import synthesizes a skill named from the filename', async () => {
    const staged = await stageUpload(Buffer.from('# Just markdown'), 'Cool Trick.md');
    try {
      expect(staged.manifest.root.type).toBe(EntityType.skill);
      expect(staged.manifest.root.name).toBe('Cool Trick');
      const { rootId } = commit(staged.sandbox, staged.manifest, []);
      expect(readFileSync(join(skillsDir(), rootId!, 'SKILL.md'), 'utf8')).toBe('# Just markdown');
    } finally {
      await discard(staged);
    }
  });

  test('a secret-shaped literal in a skill body is redacted in the packed bundle', async () => {
    const secret = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA';
    makeSkill('leaky', 'Leaky', `use this key: ${secret}`);
    const { raw } = await buildBundle(EntityType.skill, 'leaky');
    const zip = await JSZip.loadAsync(raw);
    const payloadName = Object.keys(zip.files).find((n) => n.endsWith('payload.json'))!;
    const payload = JSON.parse(await zip.file(payloadName)!.async('string')) as { content: string };
    expect(payload.content).not.toContain(secret);
    expect(payload.content).toContain('[redacted]');
  });

  test('rollback removes an imported skill entirely', () => {
    const sid = SkillExportable.import_({ slug: 'rbk', name: 'Rbk', content: 'x' }, {}, new RemapTable());
    expect(existsSync(join(skillsDir(), sid, 'SKILL.md'))).toBe(true);
    SkillExportable.rollback(sid);
    expect(existsSync(join(skillsDir(), sid))).toBe(false);
    expect(loadIndex()).not.toHaveProperty(sid);
  });

  test('checksum rejects a tampered payload', async () => {
    makeSkill('tmp', 'Tmp', '# original');
    const { raw } = await buildBundle(EntityType.skill, 'tmp');
    const src = await JSZip.loadAsync(raw);
    const out = new JSZip();
    for (const name of Object.keys(src.files)) {
      const entry = src.files[name];
      if (entry.dir) continue;
      let data = await entry.async('nodebuffer');
      if (name.endsWith('payload.json')) {
        const d = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        d.content = 'TAMPERED';
        data = Buffer.from(JSON.stringify(d, null, 2), 'utf8');
      }
      out.file(name, data);
    }
    const tampered = await out.generateAsync({ type: 'nodebuffer' });
    await expect(stageUpload(tampered, 'tmp.swarm')).rejects.toBeInstanceOf(BundleError);
  });
});

// ---------- workflow sanitize + documented stub ----------

describe('workflow sanitize + documented stub', () => {
  test("sanitizeWorkflow disables the schedule and strips the sharer's phone as PII", () => {
    const raw = {
      id: 'wf123',
      title: 'Daily digest',
      steps: [{ id: 's1', text: 'do thing' }],
      schedule: { enabled: true, runs_count: 5, next_run_at: '2026-01-01T00:00:00', hour: 9 },
      permissions: [{ kind: 'text', after_minutes: 30, phone: '+15551234567' }],
      source_session_id: 'sess1',
      dashboard_id: 'dash1',
      last_run_status: 'success',
      mode: 'agent',
      provider: 'anthropic',
    };
    const out = sanitizeWorkflow(raw);
    const schedule = out.schedule as Record<string, unknown>;
    expect(schedule.enabled).toBe(false);
    expect(schedule.runs_count).toBe(0);
    expect(schedule.hour).toBe(9); // cadence shape preserved
    expect((out.permissions as Array<Record<string, unknown>>)[0].phone).toBeNull();
    for (const dropped of ['id', 'source_session_id', 'dashboard_id', 'last_run_status']) {
      expect(out).not.toHaveProperty(dropped);
    }
    expect(out.title).toBe('Daily digest');
  });

  test('WorkflowExportable.load is always null and import_ always throws (documented scope cut until SUB-7)', () => {
    expect(WorkflowExportable.load('anything')).toBeNull();
    expect(() => WorkflowExportable.import_({ title: 'x' }, {}, new RemapTable())).toThrow(BundleError);
  });

  test('commit rolls back an already-created skill when a later entity in the bundle fails to import', () => {
    const sb = mkdtempSync(join(tmpdir(), 'maestro-swarm-commit-fail-'));
    try {
      const skillRef: EntityRef = { type: EntityType.skill, bundle_id: 's1', name: 'S', path: 'entities/s1' };
      const wfRef: EntityRef = { type: EntityType.workflow, bundle_id: 'w1', name: 'W', path: 'entities/w1' };
      for (const [ref, payload] of [
        [skillRef, { slug: 'rollme', name: 'Rollme', content: 'hi' }],
        [wfRef, { title: 'W' }],
      ] as const) {
        const dir = join(sb, 'entities', ref.bundle_id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'payload.json'), JSON.stringify(payload), 'utf8');
      }
      const preview: BundlePreview = { root_type: EntityType.skill, root_name: 'S', counts: {}, requirement_summary: [] };
      const manifest: Manifest = {
        format_version: 1, created_with: 'Maestro', created_at: '', bundle_id: 'b', checksum: null,
        root: skillRef, entities: [skillRef, wfRef], edges: [], requirements: [], preview,
      };
      // WorkflowExportable.import_ ALWAYS throws BundleError (its real, documented stub behavior --
      // see the test above), so this exercises the real rollback path with zero mocking needed.
      expect(() => commit(sb, manifest, [])).toThrow(BundleError);
      expect(loadIndex()).not.toHaveProperty('rollme');
      expect(existsSync(join(skillsDir(), 'rollme'))).toBe(false);
    } finally {
      rmSync(sb, { recursive: true, force: true });
    }
  });
});

// ---------- app export/import ----------
// Ports backend/tests/test_swarm_bundle.py's test_app_export_drops_machine_env.

describe('app export/import', () => {
  test('files() drops the live .env (machine-specific) but keeps .env.example and workspace source', () => {
    const wsDir = join(outputsWorkspaceDir(), 'ws');
    mkdirSync(join(wsDir, 'frontend'), { recursive: true });
    writeFileSync(join(wsDir, '.env'), 'FRONTEND_PORT=5\nMAESTRO_TEMPLATE_BACKEND_PATH=/Users/SECRET/x\n', 'utf8');
    writeFileSync(join(wsDir, '.env.example'), 'BACKEND_PORT=NONE\nFRONTEND_PORT=4949\n', 'utf8');
    writeFileSync(join(wsDir, 'frontend', 'App.tsx'), 'export default () => null', 'utf8');
    const output = hydrateOutput({ name: 'A', workspace_id: 'ws' });
    saveOutput(output);

    const ex = AppExportable.load(output.id);
    expect(ex).not.toBeNull();
    const files = ex!.files();
    expect(Object.keys(files)).toContain('workspace/.env.example');
    expect(Object.keys(files)).not.toContain('workspace/.env');
    expect(Object.keys(files)).toContain('workspace/frontend/App.tsx');
    const combined = Buffer.concat(Object.values(files)).toString('utf8');
    expect(combined).not.toContain('/Users/SECRET');
  });

  test('a webapp_template app survives export -> import: fresh workspace id, .env dropped, source intact', async () => {
    const wsDir = join(outputsWorkspaceDir(), 'ws2');
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'run.sh'), '#!/bin/bash\necho hi\n', 'utf8');
    writeFileSync(join(wsDir, '.env'), 'FRONTEND_PORT=6\n', 'utf8');
    writeFileSync(join(wsDir, '.env.example'), 'BACKEND_PORT=NONE\nFRONTEND_PORT=4949\n', 'utf8');
    const output = hydrateOutput({ name: 'WebApp', description: 'd', workspace_id: 'ws2' });
    saveOutput(output);

    const ex = AppExportable.load(output.id)!;
    const payload = ex.serialize(nullCtx);
    expect(payload.files).toEqual({}); // a workspace app carries no inline files -- disk is the source
    const files = ex.files();

    const newId = AppExportable.import_(payload as Record<string, unknown>, files, new RemapTable());
    expect(newId).not.toBe(output.id);
    const imported = hydrateOutput(JSON.parse(readFileSync(join(dataRoot, 'outputs', `${newId}.json`), 'utf8')) as Record<string, unknown>);
    expect(imported.name).toBe('WebApp');
    expect(imported.workspace_id).not.toBe('ws2'); // fresh workspace id, never the source's
    expect(imported.session_id).toBeNull();
    const newWsDir = join(outputsWorkspaceDir(), imported.workspace_id as string);
    expect(existsSync(join(newWsDir, 'run.sh'))).toBe(true);
    // .env itself is never carried in files() (machine-specific); pLocalizeEnv regenerates a fresh
    // one FROM .env.example, so the source's pinned FRONTEND_PORT=6 must not survive.
    const newEnv = readFileSync(join(newWsDir, '.env'), 'utf8');
    expect(newEnv).not.toContain('FRONTEND_PORT=6');
  });

  test('rollback deletes both the Output record and its workspace directory', () => {
    const wsDir = join(outputsWorkspaceDir(), 'ws3');
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'index.html'), '<html></html>', 'utf8');
    const output = hydrateOutput({ name: 'Rollme', workspace_id: 'ws3' });
    saveOutput(output);

    AppExportable.rollback(output.id);
    expect(existsSync(join(dataRoot, 'outputs', `${output.id}.json`))).toBe(false);
    expect(existsSync(wsDir)).toBe(false);
  });
});

// ---------- session export/import ----------

describe('session export/import', () => {
  test('serialize carries the transcript, drops runtime/identity/gate state', () => {
    const data = {
      name: 'A', provider: 'anthropic', model: 'sonnet', mode: 'agent',
      system_prompt: 'hi', allowed_tools: ['Read'],
      messages: [
        { id: 'm1', role: 'user', content: 'private chat', branch_id: 'main' },
        { id: 'm2', role: 'assistant', content: 'token is sk-ant-abcdefghij0123456789' },
      ],
      branches: { main: { id: 'main', parent_branch_id: null, fork_point_message_id: null } },
      active_branch_id: 'main',
      tool_group_meta: { g1: { label: 'x' } },
      active_mcps: ['Gmail'], cwd: '/Users/me/repo', cost_usd: 9.9, sdk_session_id: 'x',
    };
    saveSessionFile('s-serialize', data as unknown as Record<string, unknown>);
    const ex = SessionExportable.load('s-serialize')!;
    const out = ex.serialize(nullCtx) as Record<string, unknown>;
    expect((out.messages as Array<Record<string, unknown>>)[0].content).toBe('private chat');
    expect(out.active_branch_id).toBe('main');
    expect(out.branches).toHaveProperty('main');
    expect(out.tool_group_meta).toEqual({ g1: { label: 'x' } });
    for (const gone of ['cwd', 'active_mcps', 'cost_usd', 'sdk_session_id']) {
      expect(out).not.toHaveProperty(gone);
    }
    expect(JSON.stringify(scrubPayload(out))).not.toContain('sk-ant-');
    const reqs = ex.requirements();
    expect(reqs.some((r) => r.kind === 'mcp_action' && r.key === 'Gmail')).toBe(true);
  });

  test('import restores the transcript without granting MCP access', () => {
    const payload = {
      name: 'A', model: 'sonnet', mode: 'agent',
      messages: [{ id: 'm1', role: 'user', content: 'hi', branch_id: 'main' }],
      branches: { main: { id: 'main', parent_branch_id: null, fork_point_message_id: null } },
      active_branch_id: 'main',
      tool_group_meta: { g1: { label: 'x' } },
    };
    const sid = SessionExportable.import_(payload, {});
    const saved = loadSessionData(sid)!;
    expect((saved.messages as Array<Record<string, unknown>>)[0].content).toBe('hi');
    expect(saved.active_branch_id).toBe('main');
    expect(saved.tool_group_meta).toEqual({ g1: { label: 'x' } });
    expect(saved.active_mcps).toEqual([]);
    expect(saved.dashboard_id).toBeNull();
  });

  test('an old bundle without a transcript still imports as a valid empty-history agent', () => {
    const sid = SessionExportable.import_({ name: 'Old', model: 'sonnet' }, {});
    const saved = loadSessionData(sid)!;
    expect(saved.messages).toEqual([]);
    expect(saved.active_branch_id).toBe('main');
    expect(saved.branches).toHaveProperty('main');
  });

  test('load prefers the live in-memory session over a stale on-disk copy', () => {
    saveSessionFile('s1', { name: 'Stale', messages: [{ id: 'old', role: 'user', content: 'old' }] });
    agentManager.sessions.set('s1', createAgentSession({
      id: 's1', name: 'Live', created_at: '2026-01-01T00:00:00Z',
      branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00Z' }) },
      messages: [
        createMessage({ id: 'old', role: 'user', content: 'old', branch_id: 'main', timestamp: '2026-01-01T00:00:00Z' }),
        createMessage({ id: 'new', role: 'assistant', content: 'fresh turn', branch_id: 'main', timestamp: '2026-01-01T00:00:01Z' }),
      ],
    }));
    const out = SessionExportable.load('s1')!.serialize(nullCtx) as Record<string, unknown>;
    expect(out.name).toBe('Live');
    expect((out.messages as unknown[]).length).toBe(2);
  });
});

// ---------- dashboard export/import ----------

describe('dashboard export/import', () => {
  test('a whole dashboard (agent cards + browser card) survives export -> import with transcripts intact', async () => {
    const did = 'd1';
    const sid1 = 'sA';
    const sid2 = 'sB';
    const bkey = 'browser-1';
    const sess = (sid: string, name: string, text: string): Record<string, unknown> => ({
      id: sid, name, status: 'completed', provider: 'anthropic', model: 'sonnet', mode: 'agent', allowed_tools: [],
      messages: [{ id: 'm1', role: 'user', content: text, branch_id: 'main' }],
      branches: { main: { id: 'main', parent_branch_id: null, fork_point_message_id: null, created_at: '2026-01-01' } },
      active_branch_id: 'main', tool_group_meta: {}, active_mcps: [], dashboard_id: did,
    });
    saveSessionFile(sid1, sess(sid1, 'Agent One', 'from one'));
    saveSessionFile(sid2, sess(sid2, 'Agent Two', 'from two'));
    saveDashboard({
      id: did, name: 'Board', auto_named: false, created_at: '2026-01-01', updated_at: '2026-01-01',
      thumbnail: null, preview_updated_at: null, preview_signature: null,
      layout: {
        ...emptyDashboardLayout(),
        cards: {
          [sid1]: { session_id: sid1, x: 0, y: 0, width: 1, height: 1 },
          [sid2]: { session_id: sid2, x: 0, y: 0, width: 1, height: 1 },
        },
        browser_cards: {
          [bkey]: { browser_id: bkey, url: 'u', tabs: [], activeTabId: '', x: 0, y: 0, width: 1, height: 1, spawned_by: null, keep_open: false, dashboard_id: did },
        },
        expanded_session_ids: [sid1],
      },
    });

    const { raw } = await buildBundle(EntityType.dashboard, did);
    const staged = await stageUpload(raw, 'board.swarm');
    let rootId: string | null;
    try {
      ({ rootId } = commit(staged.sandbox, staged.manifest, []));
    } finally {
      await discard(staged);
    }
    const written = loadDashboard(rootId!)!;
    expect(Object.keys(written.layout.cards).length).toBe(2);
    expect(Object.keys(written.layout.browser_cards).length).toBe(1);
    let totalMsgs = 0;
    for (const newSid of Object.keys(written.layout.cards)) {
      const doc = loadSessionData(newSid)!;
      totalMsgs += (doc.messages as unknown[]).length;
      expect(doc.active_mcps).toEqual([]);
    }
    expect(totalMsgs).toBe(2);
  });

  test("serialize rewrites every card ref to its bundle id (incl. the app card's parent_session_id tether)", () => {
    const ctx: ExportContext = {
      bundleIdFor: (t, lid) => ({ [`${EntityType.session}:S`]: 'SBID', [`${EntityType.app}:A`]: 'ABID' } as Record<string, string>)[`${t}:${lid}`] ?? null,
    };
    const data: Dashboard = {
      id: 'd1', name: 'D', auto_named: false, created_at: '', updated_at: '', thumbnail: null, preview_updated_at: null, preview_signature: null,
      layout: {
        ...emptyDashboardLayout(),
        cards: { S: { session_id: 'S', x: 1, y: 0, width: 1, height: 1 } },
        view_cards: { A: { output_id: 'A', x: 2, y: 0, width: 1, height: 1, instance: 1, parent_session_id: 'S' } },
        browser_cards: { b1: { browser_id: 'b1', url: 'u', tabs: [], activeTabId: '', x: 0, y: 0, width: 1, height: 1, spawned_by: 'S', keep_open: false, dashboard_id: null } },
        expanded_session_ids: ['S'],
      },
    };
    const ex = new DashboardExportable('d1', 'D', data);
    const out = ex.serialize(ctx) as { layout: {
      cards: Record<string, { session_id: string }>;
      view_cards: Record<string, { output_id: string; parent_session_id: string | null }>;
      browser_cards: Record<string, { spawned_by: string | null }>;
      expanded_session_ids: string[];
    } };
    expect(out.layout.cards.SBID.session_id).toBe('SBID');
    expect(out.layout.view_cards.ABID.output_id).toBe('ABID');
    expect(out.layout.view_cards.ABID.parent_session_id).toBe('SBID');
    expect(out.layout.browser_cards.b1.spawned_by).toBe('SBID');
    expect(out.layout.expanded_session_ids).toEqual(['SBID']);
  });

  test('import remaps every ref to fresh local ids, drops dangling refs, re-stamps browser card dashboard_id', () => {
    const remap = new RemapTable();
    remap.assign('SBID', 'newsess');
    remap.assign('ABID', 'newapp');
    remap.assign('ABID2', 'newapp2');
    const payload = {
      name: 'D', layout: {
        cards: { SBID: { session_id: 'SBID' } },
        view_cards: {
          ABID: { output_id: 'ABID', parent_session_id: 'SBID' },
          ABID2: { output_id: 'ABID2', parent_session_id: 'GONE' },
        },
        browser_cards: { b1: { browser_id: 'b1', spawned_by: 'SBID', dashboard_id: 'OLD_DASH' } },
        expanded_session_ids: ['SBID', 'ORPHAN'],
      },
    };
    const did = DashboardExportable.import_(payload, {}, remap);
    const written = loadDashboard(did)!;
    const viewCards = written.layout.view_cards as unknown as Record<string, { parent_session_id: string | null }>;
    const browserCards = written.layout.browser_cards as unknown as Record<string, { spawned_by: string | null; dashboard_id: string | null }>;
    expect(written.layout.cards.newsess.session_id).toBe('newsess');
    expect(viewCards.newapp.parent_session_id).toBe('newsess');
    expect(viewCards.newapp2.parent_session_id).toBeNull();
    expect(Object.values(browserCards)[0].spawned_by).toBe('newsess');
    expect(Object.values(browserCards)[0].dashboard_id).toBe(did);
    expect(written.layout.expanded_session_ids).toEqual(['newsess']);
  });
});

// ---------- manifest validation ----------

describe('manifest structural validation', () => {
  function preview(rootType: EntityType, rootName: string): BundlePreview {
    return { root_type: rootType, root_name: rootName, counts: {}, requirement_summary: [] };
  }

  test('rejects duplicate entity ids', () => {
    const ref: EntityRef = { type: EntityType.skill, bundle_id: 'dup', name: 'A', path: 'entities/dup' };
    const m: Manifest = { format_version: 1, created_with: 'Maestro', created_at: '', bundle_id: 'b', checksum: null, root: ref, entities: [ref, ref], edges: [], requirements: [], preview: preview(EntityType.skill, 'A') };
    expect(() => validateManifest(m)).toThrow(BundleError);
  });

  test('rejects a root not present in entities', () => {
    const root: EntityRef = { type: EntityType.skill, bundle_id: 'root', name: 'A', path: 'entities/root' };
    const other: EntityRef = { type: EntityType.skill, bundle_id: 'other', name: 'B', path: 'entities/other' };
    const m: Manifest = { format_version: 1, created_with: 'Maestro', created_at: '', bundle_id: 'b', checksum: null, root, entities: [other], edges: [], requirements: [], preview: preview(EntityType.skill, 'A') };
    expect(() => validateManifest(m)).toThrow(BundleError);
  });

  test('rejects an edge pointing at an unknown entity', () => {
    const ref: EntityRef = { type: EntityType.dashboard, bundle_id: 'd', name: 'D', path: 'entities/d' };
    const m: Manifest = { format_version: 1, created_with: 'Maestro', created_at: '', bundle_id: 'b', checksum: null, root: ref, entities: [ref], edges: [{ from: 'd', to: 'ghost', relation: '' }], requirements: [], preview: preview(EntityType.dashboard, 'D') };
    expect(() => validateManifest(m)).toThrow(BundleError);
  });

  test('parseManifest rejects a structurally garbage blob', () => {
    expect(() => parseManifest({ nonsense: true })).toThrow(BundleError);
  });

  test('rejects a bundle made by a newer Maestro (format_version too high)', async () => {
    const manifest = {
      format_version: 999,
      bundle_id: 'b',
      root: { type: 'skill', bundle_id: 'x', name: 'n', path: 'entities/x' },
      entities: [{ type: 'skill', bundle_id: 'x', name: 'n', path: 'entities/x' }],
      preview: { root_type: 'skill', root_name: 'n' },
    };
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('entities/x/payload.json', JSON.stringify({ slug: 'n', name: 'n', content: 'c' }));
    const raw = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(stageUpload(raw, 'x.swarm')).rejects.toBeInstanceOf(BundleError);
  });
});

// engine/src/apps/outputs/outputs.ts -- SUB-5's native HTTP handler for backend/apps/outputs/
// outputs.py's /api/outputs surface, wired into server.ts the same way modes.ts/dashboards.ts
// already are (a `handle*HttpRequest` returning true/false).
//
// PARTIAL NATIVE, same convention 'settings'/'agents'/'dashboards' established -- every CRUD +
// workspace + persistent-runtime route outputs.py exposes is ported (the ticket's real gate: a
// real npm install/dev-server start, suspend/resume, stop, full descendant-tree kill). ONE
// DELIBERATE, DISCLOSED SCOPE CUT, not a silent gap:
//
//   - POST /vibe-code (LLM-authored code generation) needs an Anthropic client wired to
//     resolveAuxModel's aux-model resolution (registry.ts, AGT-5) PLUS the `anthropic` SDK's
//     streaming Message API, neither of which html_inject.ts's port carries (its own module doc
//     omits get_anthropic_client on purpose). Out of scope for a process-management ticket; a
//     request here returns a clear "not yet available" message rather than silently no-opping.
//
// output_versions (versions.py/versions_routes.py) IS ported -- see versions.ts/versionsRoutes.ts,
// wired into server.ts as its own 'output_versions' route-table name -- once
// `backend.apps.swarm.entities.apps.AppExportable` (SUB-3's own documented stand-in) was replaced
// with a real port as part of landing this ticket. DELETE /{output_id} below prunes that store too.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAuthToken } from '../../auth/token';
import { wsManager } from '../../agents/core/wsManager';
import {
  backendUrlForWorkspace,
  decodeDataParam,
  injectDataIntoHtml,
  injectTokenIntoRelativeUrls,
  validateAgainstSchema,
} from './htmlInject';
import {
  hydrateOutput,
  outputToApiJson,
  parseAgentCreateAppRequest,
  parseOutputCreate,
  parseOutputExecute,
  parseOutputUpdate,
  parseVibeCodeRequest,
  parseWorkspaceSeedRequest,
  type Output,
} from './models';
import { outputsDir, outputsWorkspaceDir } from './paths';
import { executeBackendCode, getCodeWarnings } from './executor';
import { loadAll, load, save, walkDirectory, wouldShrinkOversizeFile, ensureOutputsDirs } from './workspaceIo';
import { findFreePort, isNewMode, readEnvValue } from './runtimeProc';
import { loadAppBuilderSkill, seedWebappTemplateWorkspace, VIEW_TEMPLATE_FILES } from './viewBuilderTemplates';
import { manager as runtimeManager, type AppRuntime } from './runtime';
import { recoverOrphanWorkspaces, tombstone } from './recoverWorkspaces';
import { deleteAll as deleteAllVersions } from './versions';
import { registerOwner, reapOrphans, unregisterOwner } from './runtimeLedger';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep as pathSep } from 'node:path';
import { randomUUID } from 'node:crypto';

let pStarted = false;

/** Mirrors outputs_lifespan's boot half: register our liveness marker THEN reap orphans left by a
 * previous boot, then recover any workspace whose Output record was lost. Idempotent -- server.ts
 * calls this once, gated on 'outputs' actually being native (same convention as SUB-2's
 * initSkills()/startSkillRegistry() gating in main.ts), so it's a real no-op when unused. */
export function initOutputsApp(): void {
  if (pStarted) return;
  pStarted = true;
  ensureOutputsDirs();
  mkdirSync(outputsWorkspaceDir(), { recursive: true });
  try {
    registerOwner();
    void reapOrphans().then((reaped) => {
      if (reaped.length > 0) console.log(`[outputs] reaped ${reaped.length} orphaned app runtimes left by a previous session`);
    }).catch((err: unknown) => console.error('[outputs] orphan reap failed:', err));
  } catch (err) {
    console.error('[outputs] orphan reap failed:', err);
  }
  try {
    const restored = recoverOrphanWorkspaces();
    if (restored.length > 0) console.log(`[outputs] recovered ${restored.length} app workspaces with no record`);
  } catch (err) {
    console.error('[outputs] workspace recovery failed:', err);
  }
}

/** Mirrors outputs_lifespan's shutdown half: reap every per-app subprocess, then retract our
 * liveness marker last (while it exists, another instance's reaper treats our records as owned). */
export async function shutdownOutputsApp(): Promise<void> {
  if (!pStarted) return;
  try {
    runtimeManager.stopRestartWatcher();
    const killed = await runtimeManager.stopAll();
    if (killed > 0) console.log(`[outputs] reaped ${killed} workspace runtimes on shutdown`);
  } catch (err) {
    console.error('[outputs] stopAll failed during shutdown:', err);
  }
  try {
    unregisterOwner();
  } catch (err) {
    console.error('[outputs] owner marker cleanup failed:', err);
  }
  pStarted = false;
}

function parseJsonObjectBody(request: FastifyRequest): Record<string, unknown> | null {
  const raw = request.body;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badRequest(reply: FastifyReply, detail: string): true {
  reply.code(400).send({ error: 'bad_request', detail });
  return true;
}

function notFound(reply: FastifyReply, detail: string): true {
  reply.code(404).send({ detail });
  return true;
}

// Small extension -> mime map covering everything the App Builder actually generates/serves
// (index.html + JS/CSS/JSON/images). Python's mimetypes.guess_type falls back to None (this port's
// 'text/plain', matching outputs.py's own `mime or "text/plain"`) for anything unrecognized.
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.txt': 'text/plain', '.md': 'text/markdown', '.map': 'application/json',
};

function guessMime(filepath: string): string {
  const dot = filepath.lastIndexOf('.');
  if (dot < 0) return 'text/plain';
  return MIME_BY_EXT[filepath.slice(dot).toLowerCase()] ?? 'text/plain';
}

function getRuntimeForBackendUrl(workspaceId: string): { running: boolean; port: number | null } | undefined {
  return runtimeManager.get(workspaceId);
}

function runtimeStatusPayload(workspaceId: string, instance: number): Record<string, unknown> {
  const rt = runtimeManager.get(workspaceId, instance);
  if (!rt) {
    const folder = join(outputsWorkspaceDir(), workspaceId);
    const isNew = existsSync(folder) ? isNewMode(folder) : false;
    return {
      running: false, port: null, has_backend_file: false, backend_url: null,
      frontend_port: null, frontend_url: null, is_new_mode: isNew,
      python_missing: false, python_missing_detail: '',
    };
  }
  return {
    running: rt.running,
    port: rt.port,
    has_backend_file: rt.hasBackendFile,
    backend_url: rt.running && rt.port ? `http://127.0.0.1:${rt.port}` : null,
    frontend_port: rt.frontendPort,
    frontend_url: rt.running ? rt.frontendUrl : null,
    is_new_mode: rt.isNewMode,
    // PKG-2: lets the frontend show its own clear, translated copy instead of parsing runtime log
    // text -- see runtime.ts's pythonMissing/pythonMissingDetail.
    python_missing: rt.pythonMissing,
    python_missing_detail: rt.pythonMissingDetail,
  };
}

async function agentCreateAppSeed(workspaceId: string, folder: string, sessionId: string | null): Promise<string | null> {
  try {
    mkdirSync(folder, { recursive: true });
    const alreadySeeded = existsSync(join(folder, 'run.sh'));
    if (!alreadySeeded) {
      const frontendPort = await findFreePort();
      seedWebappTemplateWorkspace(folder, frontendPort);
      writeFileSync(join(folder, 'SKILL.md'), loadAppBuilderSkill(), 'utf8');
    }
    return ensureWebappWorkspaceSeededAndRegisteredSafe(workspaceId, folder, sessionId);
  } catch (err) {
    console.error(`[outputs] agent-create seed failed for ${workspaceId}:`, err);
    return null;
  }
}

function ensureWebappWorkspaceSeededAndRegisteredSafe(workspaceId: string, folder: string, sessionId: string | null): string | null {
  try {
    const existing = loadAll().filter((o) => o.workspace_id === workspaceId);
    if (existing.length > 0) {
      const output = existing[0];
      if (sessionId && output.session_id !== sessionId) {
        output.session_id = sessionId;
        output.updated_at = new Date().toISOString();
        save(output);
      }
      return output.id;
    }
    const now = new Date().toISOString();
    const output = hydrateOutput({
      name: 'Untitled App', description: '', icon: 'view_quilt', files: {},
      workspace_id: workspaceId, session_id: sessionId, created_at: now, updated_at: now,
    });
    save(output);
    return output.id;
  } catch (err) {
    console.error(`[outputs] register failed for ${workspaceId}:`, err);
    return null;
  }
}

function safeJoinWorkspacePath(folder: string, filepath: string): string | null {
  const folderNorm = normalize(folder);
  const full = normalize(join(folder, filepath));
  if (full !== folderNorm && !full.startsWith(folderNorm + pathSep)) return null;
  return full;
}

export async function handleOutputsHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!pathname.startsWith('/api/outputs')) return false;
  initOutputsApp();
  const sub = pathname.slice('/api/outputs'.length) || '/';
  const method = request.method.toUpperCase();
  const query = (request.query ?? {}) as Record<string, string | undefined>;
  const instance = (() => {
    const raw = query.instance;
    const n = raw !== undefined ? Number(raw) : 1;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  })();

  // --- file-serving endpoints ---
  let m = /^\/workspace\/([^/]+)\/serve\/(.+)$/.exec(sub);
  if (m && method === 'GET') {
    const [, workspaceId, filepath] = m;
    const folder = join(outputsWorkspaceDir(), workspaceId);
    const fullPath = safeJoinWorkspacePath(folder, decodeURIComponent(filepath));
    if (fullPath === null) return badRequest(reply, 'Path traversal not allowed');
    if (!existsSync(fullPath)) return notFound(reply, 'File not found');
    let content = readFileSync(fullPath, 'utf8');
    if (filepath === 'index.html') {
      const pD = query.p_d ?? '';
      const [inputJson, resultJson] = pD ? decodeDataParam(pD) : ['{}', 'null'];
      const backendUrlJson = backendUrlForWorkspace(workspaceId, getRuntimeForBackendUrl);
      content = injectDataIntoHtml(content, inputJson, resultJson, backendUrlJson, true);
      content = injectTokenIntoRelativeUrls(content, getAuthToken());
    }
    reply.code(200).header('content-type', guessMime(filepath)).send(content);
    return true;
  }

  // --- CRUD + workspace endpoints ---
  if (sub === '/list' && method === 'GET') {
    reply.code(200).send({ outputs: loadAll().map((o) => outputToApiJson(o)) });
    return true;
  }

  m = /^\/workspace\/([^/]+)$/.exec(sub);
  if (m && method === 'GET') {
    const [, workspaceId] = m;
    const folder = join(outputsWorkspaceDir(), workspaceId);
    if (!existsSync(folder)) return notFound(reply, 'Workspace not found');
    const { files, truncated } = walkDirectory(folder);
    let meta: unknown = null;
    if (files['meta.json']) {
      try { meta = JSON.parse(files['meta.json']); } catch { /* leave null */ }
    }
    reply.code(200).send({ files, meta, path: folder, truncated });
    return true;
  }

  if (sub === '/agent-create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const parsed = parseAgentCreateAppRequest(body);
    if (parsed === null) return badRequest(reply, 'name is required');
    const workspaceId = randomUUID().replace(/-/g, '');
    const folder = join(outputsWorkspaceDir(), workspaceId);
    const outputId = await agentCreateAppSeed(workspaceId, folder, parsed.parent_session_id || null);
    if (!outputId) {
      reply.code(500).send({ detail: 'workspace seed/registration failed' });
      return true;
    }
    const output = load(outputId) as Output;
    output.name = parsed.name.trim() || 'Untitled App';
    output.description = parsed.description.trim();
    output.updated_at = new Date().toISOString();
    save(output);
    try {
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ name: output.name, description: output.description }, null, 2), 'utf8');
    } catch (err) {
      console.error(`[outputs] agent-create meta.json write failed for ${workspaceId}:`, err);
    }
    try {
      await wsManager.broadcastGlobal('agent:output_upserted', { output: outputToApiJson(output) });
    } catch (err) {
      console.error('[outputs] agent-create output_upserted broadcast failed:', err);
    }
    reply.code(200).send({ ok: true, output_id: outputId, path: folder });
    return true;
  }

  if (sub === '/workspace/seed' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const parsed = parseWorkspaceSeedRequest(body);
    if (parsed === null) return badRequest(reply, 'workspace_id is required');
    const folder = join(outputsWorkspaceDir(), parsed.workspace_id);
    mkdirSync(folder, { recursive: true });
    const effectiveMode = parsed.files && Object.keys(parsed.files).length > 0 ? 'flat' : parsed.template_mode;

    if (effectiveMode === 'webapp_template') {
      const alreadySeeded = existsSync(join(folder, 'run.sh'));
      let frontendPort: number;
      if (alreadySeeded) {
        const fpRaw = readEnvValue(join(folder, '.env'), 'FRONTEND_PORT');
        const parsedPort = fpRaw ? Number(fpRaw) : NaN;
        frontendPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : await findFreePort();
      } else {
        frontendPort = await findFreePort();
        seedWebappTemplateWorkspace(folder, frontendPort);
        writeFileSync(join(folder, 'SKILL.md'), loadAppBuilderSkill(), 'utf8');
      }
      const meta = parsed.meta ?? {};
      if (parsed.meta && !alreadySeeded) {
        writeFileSync(join(folder, 'meta.json'), JSON.stringify(parsed.meta, null, 2), 'utf8');
      }
      let outputId: string | null = null;
      try {
        const existing = loadAll().filter((o) => o.workspace_id === parsed.workspace_id);
        if (existing.length > 0) {
          outputId = existing[0].id;
        } else {
          const now = new Date().toISOString();
          const output = hydrateOutput({
            name: (meta as Record<string, unknown>).name ?? 'Untitled App',
            description: (meta as Record<string, unknown>).description ?? '',
            icon: 'view_quilt', files: {}, workspace_id: parsed.workspace_id, created_at: now, updated_at: now,
          });
          save(output);
          outputId = output.id;
        }
      } catch (err) {
        console.error(`[outputs] seed-time Output create failed for ${parsed.workspace_id}:`, err);
      }
      reply.code(200).send({ path: folder, template_mode: 'webapp_template', frontend_port: frontendPort, output_id: outputId, already_seeded: alreadySeeded });
      return true;
    }

    // Legacy flat path: seed only fills in MISSING files, never overwrites what's on disk.
    if (parsed.files && Object.keys(parsed.files).length > 0) {
      for (const [relPath, content] of Object.entries(parsed.files)) {
        const fullPath = safeJoinWorkspacePath(folder, relPath);
        if (fullPath === null) continue;
        if (existsSync(fullPath)) continue;
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
      }
    } else {
      for (const [relPath, content] of Object.entries(VIEW_TEMPLATE_FILES)) {
        const fullPath = join(folder, relPath);
        if (existsSync(fullPath)) continue;
        writeFileSync(fullPath, content, 'utf8');
      }
    }
    const skillPath = join(folder, 'SKILL.md');
    if (!existsSync(skillPath)) writeFileSync(skillPath, loadAppBuilderSkill(), 'utf8');
    if (parsed.meta) {
      const metaPath = join(folder, 'meta.json');
      if (!existsSync(metaPath)) writeFileSync(metaPath, JSON.stringify(parsed.meta, null, 2), 'utf8');
    }
    reply.code(200).send({ path: folder, template_mode: 'flat' });
    return true;
  }

  // --- persistent runtime control ---
  m = /^\/workspace\/([^/]+)\/runtime\/start$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    const folder = join(outputsWorkspaceDir(), workspaceId);
    if (!existsSync(folder)) return notFound(reply, 'Workspace not found');
    await runtimeManager.attach(workspaceId, folder, instance);
    reply.code(200).send(runtimeStatusPayload(workspaceId, instance));
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/stop$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    await runtimeManager.detach(workspaceId, instance);
    reply.code(200).send(runtimeStatusPayload(workspaceId, instance));
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/restart$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    const folder = join(outputsWorkspaceDir(), workspaceId);
    if (!existsSync(folder)) return notFound(reply, 'Workspace not found');
    const rt = runtimeManager.get(workspaceId, instance);
    if (rt) await runtimeManager.restart(workspaceId, folder, instance);
    reply.code(200).send(runtimeStatusPayload(workspaceId, instance));
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/status$/.exec(sub);
  if (m && method === 'GET') {
    const [, workspaceId] = m;
    reply.code(200).send(runtimeStatusPayload(workspaceId, instance));
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/report-error$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    const rt = runtimeManager.get(workspaceId, instance) as AppRuntime | undefined;
    const body = parseJsonObjectBody(request) ?? {};
    if (!rt) { reply.code(200).send({ ok: false, recorded: 0 }); return true; }
    const message = String(body.message ?? '').trim();
    const componentStack = String(body.componentStack ?? '').trim();
    if (!message) { reply.code(200).send({ ok: false, recorded: 0 }); return true; }
    rt.setRenderError(componentStack ? `${message}\n${componentStack}` : message);
    reply.code(200).send({ ok: true, recorded: 1 });
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/console-log$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    const rt = runtimeManager.get(workspaceId, instance) as AppRuntime | undefined;
    const body = parseJsonObjectBody(request) ?? {};
    if (!rt) { reply.code(200).send({ ok: false, recorded: 0 }); return true; }
    const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    let recorded = 0;
    for (const entry of lines.slice(0, 200)) {
      const text = String(entry.text ?? '').trim();
      if (!text) continue;
      rt.recordFrontendLog(String(entry.level ?? 'log'), text);
      recorded += 1;
    }
    reply.code(200).send({ ok: true, recorded });
    return true;
  }
  m = /^\/workspace\/([^/]+)\/runtime\/report-ready$/.exec(sub);
  if (m && method === 'POST') {
    const [, workspaceId] = m;
    const rt = runtimeManager.get(workspaceId, instance) as AppRuntime | undefined;
    if (!rt) { reply.code(200).send({ ok: false }); return true; }
    rt.setRenderOk();
    reply.code(200).send({ ok: true });
    return true;
  }
  if (sub === '/shutdown-all' && method === 'POST') {
    const killed = await runtimeManager.stopAll();
    reply.code(200).send({ ok: true, killed });
    return true;
  }

  // --- workspace file write/delete ---
  m = /^\/workspace\/([^/]+)\/file\/(.+)$/.exec(sub);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const [, workspaceId, filepath] = m;
    const folder = join(outputsWorkspaceDir(), workspaceId);
    if (!existsSync(folder)) return notFound(reply, 'Workspace not found');
    const fullPath = safeJoinWorkspacePath(folder, decodeURIComponent(filepath));
    if (fullPath === null) return badRequest(reply, 'Path traversal not allowed');
    if (method === 'PUT') {
      const body = parseJsonObjectBody(request) ?? {};
      const content = String(body.content ?? '');
      if (wouldShrinkOversizeFile(fullPath, content)) {
        reply.code(200).send({ ok: true, skipped: 'oversize' });
        return true;
      }
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
      reply.code(200).send({ ok: true });
      return true;
    }
    // DELETE: remove the file, then prune now-empty parent directories up to (not including) the
    // workspace root, mirroring outputs.py's own upward os.rmdir loop.
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
      let parent = dirname(fullPath);
      const folderNorm = normalize(folder);
      while (parent !== folderNorm) {
        try {
          if (existsSync(parent) && readFileSyncSafeIsEmpty(parent)) {
            rmdirSync(parent);
            parent = dirname(parent);
          } else break;
        } catch { break; }
      }
    }
    reply.code(200).send({ ok: true });
    return true;
  }

  m = /^\/([^/]+)\/serve\/(.+)$/.exec(sub);
  if (m && method === 'GET') {
    const [, outputId, filepath] = m;
    const output = load(outputId);
    if (!output) return notFound(reply, 'File not found in output');
    const content = output.files[filepath];
    if (content === undefined) return notFound(reply, 'File not found in output');
    let served = content;
    if (filepath === 'index.html') {
      const pD = query.p_d ?? '';
      const [inputJson, resultJson] = pD ? decodeDataParam(pD) : ['{}', 'null'];
      const backendUrlJson = output.workspace_id ? backendUrlForWorkspace(output.workspace_id, getRuntimeForBackendUrl) : 'null';
      served = injectDataIntoHtml(served, inputJson, resultJson, backendUrlJson, true);
      served = injectTokenIntoRelativeUrls(served, getAuthToken());
    }
    reply.code(200).header('content-type', guessMime(filepath)).send(served);
    return true;
  }

  if (sub === '/create' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const parsed = parseOutputCreate(body);
    if (parsed === null) return badRequest(reply, 'name is required');
    const now = new Date().toISOString();
    const output = hydrateOutput({ ...parsed, created_at: now, updated_at: now });
    save(output);
    reply.code(200).send({ ok: true, output: outputToApiJson(output) });
    return true;
  }

  if (sub === '/execute' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const parsed = parseOutputExecute(body);
    if (parsed === null) return badRequest(reply, 'output_id is required');
    const output = load(parsed.output_id);
    if (!output) return notFound(reply, 'Output not found');
    const validationErr = validateAgainstSchema(parsed.input_data, output.input_schema);
    if (validationErr) {
      reply.code(200).send({
        output_id: output.id, output_name: output.name, frontend_code: output.files['index.html'] ?? '',
        input_data: parsed.input_data, backend_result: null, error: validationErr,
      });
      return true;
    }
    let backendResult: unknown = null, stdoutText: string | null = null, stderrText: string | null = null;
    let error: string | null = null, warningsOut: string[] | null = null, codePreview: string | null = null;
    const backendCode = output.files['backend.py'];
    if (backendCode) {
      if (!parsed.force) {
        warningsOut = await getCodeWarnings(backendCode);
        if (warningsOut.length > 0) codePreview = backendCode; else warningsOut = null;
      }
      if (!warningsOut) {
        try {
          const execResult = await executeBackendCode(backendCode, parsed.input_data, { skipValidation: true });
          backendResult = execResult.result;
          stdoutText = execResult.stdout;
          stderrText = execResult.stderr;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
    }
    reply.code(200).send({
      output_id: output.id, output_name: output.name, frontend_code: output.files['index.html'] ?? '',
      input_data: parsed.input_data, backend_result: backendResult, stdout: stdoutText, stderr: stderrText,
      error, warnings: warningsOut, code_preview: codePreview,
    });
    return true;
  }

  if (sub === '/vibe-code' && method === 'POST') {
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const parsed = parseVibeCodeRequest(body);
    if (parsed === null) return badRequest(reply, 'prompt is required');
    // Scope cut -- see this file's own header. Returns the input unchanged with a clear message
    // rather than a 501, matching the Python route's own "anthropic SDK not installed" fallback
    // shape (same response keys), so an editor calling this degrades gracefully either way.
    reply.code(200).send({
      message: 'Vibe-code generation is not yet available in this build (SUB-5 scope cut: needs aux-model + Anthropic SDK wiring).',
      frontend_code: parsed.current_frontend_code,
      backend_code: parsed.current_backend_code,
      input_schema: parsed.current_schema,
    });
    return true;
  }

  m = /^\/([^/]+)$/.exec(sub);
  if (m && method === 'GET') {
    const [, outputId] = m;
    const output = load(outputId);
    if (!output) return notFound(reply, 'Output not found');
    reply.code(200).send(outputToApiJson(output));
    return true;
  }
  if (m && method === 'PUT') {
    const [, outputId] = m;
    const output = load(outputId);
    if (!output) return notFound(reply, 'Output not found');
    const body = parseJsonObjectBody(request);
    if (body === null) return badRequest(reply, 'body must be a JSON object');
    const { value, setKeys } = parseOutputUpdate(body);
    for (const key of setKeys) {
      (output as unknown as Record<string, unknown>)[key] = (value as unknown as Record<string, unknown>)[key];
    }
    const now = new Date().toISOString();
    output.updated_at = now;
    if (setKeys.has('thumbnail')) output.preview_updated_at = now;
    save(output);
    reply.code(200).send({ ok: true, output: outputToApiJson(output) });
    return true;
  }
  if (m && method === 'DELETE') {
    const [, outputId] = m;
    const output = load(outputId);
    if (!output) return notFound(reply, 'Output not found');
    if (output.workspace_id) tombstone(output.workspace_id);
    const path = join(outputsDir(), `${outputId}.json`);
    if (existsSync(path)) unlinkSync(path);
    deleteAllVersions(outputId);
    reply.code(200).send({ ok: true });
    return true;
  }

  return false;
}

function readFileSyncSafeIsEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

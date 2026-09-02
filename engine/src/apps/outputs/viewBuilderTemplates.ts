// engine/src/apps/outputs/viewBuilderTemplates.ts -- SUB-5, a SCOPED port of
// backend/apps/outputs/view_builder_templates.py: default template files seeded into new App
// Builder workspaces.
//
// backend/apps/outputs/webapp_template/ is READ-ONLY reference material (this ticket's own
// instructions: it's on check-fork-drift.mjs's ALLOW list deliberately, keep its legacy
// identifiers) -- this module reads/copies FROM it by absolute path, exactly the precedent SUB-2
// set for backend/mcp-bundles/** and SUB-4 for backend/apps/*_mcp_shim/**. It never writes there.
//
// DELIBERATE, DISCLOSED SCOPE CUT: the Python original also pre-warms a SHARED node_modules cache
// (symlinked into every new workspace so the very first app-create skips `npm install` entirely)
// and a shared backend-venv cache for `bash backend_init.sh`. This port omits BOTH warm caches --
// not because they're hard, but because webapp_template/frontend/run.sh (read, not edited: see
// this file's own copy) ALREADY self-heals with a real, full `npm install --prefer-offline
// --no-audit --no-fund` whenever `node_modules/.bin/vite` is missing (its own comment: "Fast path:
// the seeder usually symlinks node_modules to a shared warm cache ... [but if missing] Installing
// dependencies..."). So omitting the warm-cache pre-link does not remove any capability -- it just
// means EVERY workspace pays the first-install cost run.sh already knows how to pay, instead of
// only the first ever workspace paying it. That is exactly the real, observable "npm install runs
// for real" behavior this ticket's own GATE asks to witness, so this scope cut does not weaken the
// gate -- it is the gate's natural path. A future ticket can add the warm-cache optimization
// (Node's `cpSync`/`symlinkSync` cover the mechanics; `ensure_warm_cache`'s bundled-archive-tar
// fast path is itself Mac/Linux-oriented and not the Windows-primary path this migration targets).

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// engine/src/apps/outputs -> apps -> src -> engine -> repo root (4 levels), matching
// pythonBackend.ts's own P_REPO_ROOT anchor pattern one level shallower.
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const P_OUTPUTS_SRC_DIR = join(P_REPO_ROOT, 'backend', 'apps', 'outputs');

export const APP_BUILDER_SKILL_SOURCE_PATH = join(P_OUTPUTS_SRC_DIR, 'app_builder_skill.md');
export const WEBAPP_TEMPLATE_DIR = join(P_OUTPUTS_SRC_DIR, 'webapp_template');
export const DEBUGGER_PATH = resolve(P_REPO_ROOT, 'debugger');
export const TEMPLATE_BACKEND_PATH = resolve(join(WEBAPP_TEMPLATE_DIR, 'backend'));

let pAppBuilderSkillDefault: string | null = null;

/** Bundled default; read once and cached, matching view_builder_templates.py's module-import-time
 * read (a missing file at this stage is a packaging bug either way, so failing loudly here is
 * correct rather than a silent empty string). */
function appBuilderSkillDefault(): string {
  if (pAppBuilderSkillDefault === null) {
    pAppBuilderSkillDefault = readFileSync(APP_BUILDER_SKILL_SOURCE_PATH, 'utf8');
  }
  return pAppBuilderSkillDefault;
}

/** Return the live App Builder skill content. Prefers the user-editable copy at
 * ~/.claude/skills/app_builder_skill.md (so a user's edit on the Skills page takes effect on the
 * very next App Builder agent turn), falling back to the bundled default. */
export function loadAppBuilderSkill(): string {
  const userPath = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'skills', 'app_builder_skill.md');
  if (existsSync(userPath)) {
    try {
      return readFileSync(userPath, 'utf8');
    } catch {
      // Fall through to the bundled default.
    }
  }
  return appBuilderSkillDefault();
}

const VIEW_TEMPLATE_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      background: #1a1d27;
      border: 1px solid #2e3248;
      border-radius: 12px;
      padding: 32px;
      max-width: 600px;
      width: 100%;
      text-align: center;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 8px; }
    p { color: #8892a4; font-size: 0.95rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="title">Ready</h1>
    <p id="desc">Describe what you want to build and the agent will update this app.</p>
  </div>
  <script>
    const input = window.OUTPUT_INPUT || {};
    const result = window.OUTPUT_BACKEND_RESULT || null;
  </script>
</body>
</html>
`;

const VIEW_TEMPLATE_SCHEMA = `{
  "type": "object",
  "properties": {},
  "required": []
}
`;

const VIEW_TEMPLATE_META = `{
  "name": "",
  "description": ""
}
`;

export const VIEW_TEMPLATE_FILES: Record<string, string> = {
  'index.html': VIEW_TEMPLATE_INDEX,
  'schema.json': VIEW_TEMPLATE_SCHEMA,
  'meta.json': VIEW_TEMPLATE_META,
};

/** Idempotent in-place rewrite: `KEY=...` -> `KEY=value`. Appends if the key isn't present. */
export function patchEnvPort(envPath: string, key: string, value: string): void {
  if (!existsSync(envPath)) return;
  let text = readFileSync(envPath, 'utf8');
  const pat = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
  const newLine = `${key}=${value}`;
  if (pat.test(text)) {
    text = text.replace(pat, newLine);
  } else {
    if (text && !text.endsWith('\n')) text += '\n';
    text += `${newLine}\n`;
  }
  writeFileSync(envPath, text);
}

/** Copy the vendored webapp-template snapshot into `workspaceDir`, excluding the master template's
 * top-level `backend/` (brought in on-demand by the workspace's own `backend_init.sh`), then wire
 * up `.env`/`.env.example` with the allocated frontend port and this install's template-backend
 * path. See module doc for the deliberate node_modules/venv warm-cache scope cut. */
export function seedWebappTemplateWorkspace(workspaceDir: string, frontendPort: number): void {
  mkdirSync(workspaceDir, { recursive: true });
  cpSync(WEBAPP_TEMPLATE_DIR, workspaceDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      // cpSync's filter receives the SOURCE path for every entry under WEBAPP_TEMPLATE_DIR;
      // exclude only the top-level backend/ directory (and everything under it), mirroring
      // p_ignore_backend's own top-level-only scoping.
      const rel = src.slice(WEBAPP_TEMPLATE_DIR.length).replace(/^[/\\]/, '');
      return rel !== 'backend' && !rel.startsWith(`backend${sep}`);
    },
  });

  const envPath = join(workspaceDir, '.env');
  const envExamplePath = join(workspaceDir, '.env.example');
  const srcExample = join(WEBAPP_TEMPLATE_DIR, '.env.example');
  if (existsSync(srcExample)) {
    cpSync(srcExample, envPath, { force: true });
  } else {
    writeFileSync(envPath, 'BACKEND_PORT=NONE\nFRONTEND_PORT=4949\n');
  }

  patchEnvPort(envPath, 'FRONTEND_PORT', String(frontendPort));
  patchEnvPort(envExamplePath, 'FRONTEND_PORT', String(frontendPort));
  patchEnvPort(envPath, 'MAESTRO_TEMPLATE_BACKEND_PATH', TEMPLATE_BACKEND_PATH);

  // Make the shipped scripts executable -- a no-op on Windows (chmod has no real filesystem effect
  // there) but harmless, and required for a POSIX host running this same workspace.
  for (const script of ['run.sh', 'backend_init.sh', 'restart.sh', join('frontend', 'run.sh')]) {
    const p = join(workspaceDir, script);
    if (existsSync(p)) {
      try {
        chmodSync(p, 0o755);
      } catch {
        // Best-effort, matches the Python original's own "may be a no-op on some platforms" stance.
      }
    }
  }
}

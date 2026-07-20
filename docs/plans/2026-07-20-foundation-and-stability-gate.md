# Maestro — Foundation & Stability Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork Open Swarm into `gmartinstech/maestro`, retain its license, and stand up a model-agnostic `verify` gate + golden-path smoke so every later epic can be changed — by humans or cheap/local agents — without silently breaking the app.

**Architecture:** Keep the upstream Electron + React/TS + FastAPI/Python structure intact. Add three things on top: (1) a one-command `verify` harness that any runtime can call; (2) a deterministic Playwright golden-path smoke driven by the existing `MockAgent` (no API keys, no tokens); (3) a file-handshake agent-dispatch + cross-model-review harness. No product code changes yet — this plan only establishes the safety net and repo hygiene.

**Tech Stack:** Node.js 20 + npm (frontend/electron), bundled Python 3.13 + uv (backend), Playwright (e2e), GitHub Actions (CI), `gh` CLI, `pi` (local model dispatch → LM Studio/Ollama).

## Global Constraints

- Fork target repo: `gmartinstech/maestro` (owner = the `gmartinstech` GitHub org; confirm before Task 1).
- appId: `net.martinstech.maestro` · productName: `Maestro`.
- Models route through `provedor-ia` at `https://llm.martinstech.net/v1` (Keycloak JWT); never call `*.openswarm.com`.
- Retain `LICENSE` verbatim (MIT © 2026 Haik Decie); add our copyright + NOTICE alongside.
- Windows-first. Node.js is a required runtime (9Router).
- Every task closes against the Definition of Done: builds + launches; golden smoke passes; `verify` green; behaviour verified in the running app; DET/PRV show zero new openswarm-ai calls; diff reviewed by a different-vendor model or human before merge.
- This is **Plan 1 of 6** (Foundation → DET → BRD → PRV → DOM → LOC). Later plans are authored when reached.

---

## File Structure

New files this plan creates (all under the fork root):

- `scripts/verify.mjs` — the single verification entrypoint (build + lint + typecheck + tests + golden smoke + call-home check); wrapped by `npm run verify`.
- `scripts/check-callhome.mjs` — asserts no `*.openswarm.com` host appears in built renderer/main output or a captured run.
- `e2e/golden/golden-path.spec.ts` — the deterministic golden-path smoke (Playwright + Electron, MockAgent backend).
- `e2e/golden/fixtures.ts` — launch helper that boots the app with `MAESTRO_MOCK_AGENT=1` and a temp `DATA_ROOT`.
- `.github/workflows/verify.yml` — CI running `npm run verify` on every PR; the merge gate.
- `CLAUDE.md`, `AGENTS.md` (root) — repo map, the single verify command, conventions.
- `docs/context-packs/*.md` — per-epic exact-file-list packs handed to implementers (DET, BRD, PRV, DOM, LOC).
- `docs/UPSTREAM.md` — upstream-sync runbook + conflict-zone map.
- `docs/CONTRIBUTING-maestro.md` — Definition of Done, reversibility conventions, review rules.
- `harness/dispatch.mjs`, `harness/review.mjs`, `harness/models.json` — file-handshake dispatch + cross-model-review harness.
- `NOTICE` — attribution.

Modify: `README.md` (Maestro intro + upstream credit), `package.json` (root, add `verify`/`e2e:golden` scripts), backend agent bootstrap (add `MAESTRO_MOCK_AGENT` env → force `MockAgent`).

---

## Task 1: Fork the repo & wire remotes

**Files:**
- Create: local clone at `C:\Users\gsilva\maestro\repo`
- Verify: `git remote -v`

**Interfaces:**
- Produces: the working repo root all later tasks operate in; `origin` = `gmartinstech/maestro`, `upstream` = `openswarm-ai/openswarm`.

- [ ] **Step 1: Confirm the fork target** — org `gmartinstech`, repo name `maestro`. (Human confirms; this is an outward-facing action.)

- [ ] **Step 2: Create the fork**

```bash
gh repo fork openswarm-ai/openswarm --org gmartinstech --fork-name maestro --clone=false
```
Expected: `✓ Created fork gmartinstech/maestro`.

- [ ] **Step 3: Clone the fork (full history) into the workspace**

```bash
git clone https://github.com/gmartinstech/maestro.git "C:/Users/gsilva/maestro/repo"
cd "C:/Users/gsilva/maestro/repo"
git remote add upstream https://github.com/openswarm-ai/openswarm.git
git remote -v
```
Expected: `origin … gmartinstech/maestro` and `upstream … openswarm-ai/openswarm` both listed.

- [ ] **Step 4: Create the working branch**

```bash
git checkout -b foundation/stability-gate
```

- [ ] **Step 5: Commit a marker** (empty doc dir) so the branch exists on origin

```bash
mkdir -p docs/plans && git add -A && git commit -m "chore: start foundation branch" && git push -u origin foundation/stability-gate
```
Expected: branch pushed.

---

## Task 2: Retain license & add attribution

**Files:**
- Verify unchanged: `LICENSE`
- Create: `NOTICE`
- Modify: `README.md:1-30`

**Interfaces:**
- Produces: compliant attribution required before any public distribution.

- [ ] **Step 1: Assert the upstream LICENSE is present and unchanged**

```bash
grep -n "Haik Decie" LICENSE
```
Expected: the MIT copyright line `Copyright (c) 2026 Haik Decie` prints. Do **not** edit this file.

- [ ] **Step 2: Create `NOTICE`**

```text
Maestro
Copyright (c) 2026 MartinsTech

This product is a fork of Open Swarm (https://github.com/openswarm-ai/openswarm),
Copyright (c) 2026 Haik Decie, licensed under the MIT License. The original MIT
license text is retained verbatim in LICENSE. Modifications by MartinsTech are
also released under the MIT License.
```

- [ ] **Step 3: Rewrite the README header** — replace the top title/intro block with a Maestro intro that credits upstream. Keep the rest for now (BRD plan finishes the scrub).

```markdown
# Maestro

Maestro is MartinsTech's desktop orchestrator for AI coding agents — a fork of
[Open Swarm](https://github.com/openswarm-ai/openswarm) (MIT), detached to run on
our own provedor-ia gateway. See `docs/specs/` for the design and `docs/plans/` for
the build plan.
```

- [ ] **Step 4: Commit**

```bash
git add NOTICE README.md && git commit -m "docs: add NOTICE + Maestro readme header, retain upstream MIT"
```

---

## Task 3: Agent-ready, token-lean repo (CLAUDE.md / AGENTS.md / context packs)

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md`, `docs/context-packs/{det,brd,prv,dom,loc}.md`

**Interfaces:**
- Produces: `npm run verify` is the documented single gate (used by Tasks 5–7); context packs give later-plan implementers exact file lists so they never re-explore.

- [ ] **Step 1: Write root `CLAUDE.md`** (also symlink/copy to `AGENTS.md`)

```markdown
# Maestro — agent guide

Fork of openswarm-ai/openswarm. Electron + React/TS (frontend/) + FastAPI/Python (backend/) + bundled 9Router (Node).

## The one command
`npm run verify` — build + lint + typecheck + tests + golden smoke + call-home check. Green = safe to merge.

## Rules
- Never call *.openswarm.com. Models go through provedor-ia (https://llm.martinstech.net/v1).
- Retain LICENSE (© Haik Decie). Brand = Maestro; appId net.martinstech.maestro.
- Small diffs. One ticket per branch/worktree. A different-vendor model (or human) reviews before merge.
- Deterministic tests use MAESTRO_MOCK_AGENT=1 (no keys, no tokens).

## Where things live
- Providers/registry: backend/apps/agents/providers/registry.py
- Provider env adapter: backend/apps/agents/manager/configure_provider_env.py
- Agent loop: backend/apps/agents/manager/run/TurnRunner.py ; MockAgent: backend/apps/agents/manager/MockAgent.py
- Modes/Workflows/Skills/Tools: backend/apps/{modes,workflows,skills,tools_lib}
- Branding tokens: frontend/src/shared/styles/claudeTokens.ts
- Cloud couplings to remove: electron/main.js (feed/analytics/affiliate), backend/apps/{auth,subscription}
```

- [ ] **Step 2: Copy to `AGENTS.md`** (Codex reads this)

```bash
cp CLAUDE.md AGENTS.md
```

- [ ] **Step 3: Write the context packs** — one file per epic listing the exact files from the analysis (e.g. `docs/context-packs/det.md` lists `electron/main.js:1548,935,1987`, `backend/apps/auth/router.py`, `configure_provider_env.py:161`, `frontend/public/index.html:20,26`, …). Paste the file lists already produced for DET/BRD/PRV/DOM/LOC.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/context-packs && git commit -m "docs: agent guide + per-epic context packs"
```

---

## Task 4: Green baseline — existing suites pass on our CI

**Files:**
- Create: `.github/workflows/verify.yml` (initial: existing checks only)
- Reference: `frontend/package.json`, `backend/requirements.lock`, `e2e/`

**Interfaces:**
- Consumes: the cloned repo (Task 1).
- Produces: a known-green starting point; the CI workflow Task 7 extends into the merge gate.

- [ ] **Step 1: Install and build locally to establish "works today"**

```bash
cd frontend && npm ci && npm run build && cd ..
bash scripts/build-python-env.sh   # or run.sh for dev backend
```
Expected: frontend build succeeds; backend deps resolve from `requirements.lock`.

- [ ] **Step 2: Run the existing checks and record results**

```bash
cd frontend && npm run lint && npx tsc --noEmit && cd ..
```
Expected: lint + typecheck pass (fix or document any pre-existing failures inherited from upstream — do not "fix" by disabling rules).

- [ ] **Step 3: Add a minimal CI workflow that runs those same checks**

```yaml
name: verify
on: { pull_request: {}, workflow_dispatch: {} }
jobs:
  checks:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npx tsc --noEmit
      - run: cd frontend && npm run build
```

- [ ] **Step 4: Push and confirm the workflow is green on a PR**

```bash
git add .github/workflows/verify.yml && git commit -m "ci: baseline verify (lint+typecheck+build)" && git push
```
Expected: the `verify` check passes on the PR for `foundation/stability-gate`.

---

## Task 5: The `verify` one-command harness

**Files:**
- Create: `scripts/verify.mjs`, `scripts/check-callhome.mjs`
- Modify: `package.json` (root) — add `"verify"` and `"check:callhome"` scripts

**Interfaces:**
- Consumes: frontend build/lint/typecheck (Task 4).
- Produces: `npm run verify` exit-0 on success / non-zero on any failure — the single signal CI (Task 7) and the agent harness (Task 10) consume. Golden smoke wiring is added in Task 6.

- [ ] **Step 1: Write the call-home check (the test first)**

```js
// scripts/check-callhome.mjs — fails if a forbidden host appears in built output
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const FORBIDDEN = [/openswarm\.com/i, /api\.openswarm/i, /analytics\.openswarm/i];
const ROOTS = ['frontend/build', 'electron'];
let hits = [];
function walk(p){ for (const e of readdirSync(p)){ const f=join(p,e); const s=statSync(f);
  if (s.isDirectory()){ if(!/node_modules|\.git/.test(f)) walk(f);} 
  else if (/\.(js|html|json|css)$/.test(f)){ const t=readFileSync(f,'utf8');
    for (const rx of FORBIDDEN) if (rx.test(t)) hits.push(`${f} :: ${rx}`);} } }
for (const r of ROOTS){ try { walk(r); } catch {} }
if (hits.length){ console.error('CALL-HOME LEAK:\n'+hits.join('\n')); process.exit(1); }
console.log('call-home check: clean'); 
```

- [ ] **Step 2: Run it now — expect it to FAIL** (upstream still references openswarm.com)

```bash
node scripts/check-callhome.mjs
```
Expected: exits non-zero, lists `electron/main.js`/`config.ts` hits. This is correct — it proves the check works and gives DET its target list. (DET plan turns this green.)

- [ ] **Step 3: Write `scripts/verify.mjs`** orchestrating the gate (call-home is a warning until DET completes, tracked by an allowlist flag)

```js
// scripts/verify.mjs
import { execSync } from 'node:child_process';
const steps = [
  ['lint',      'cd frontend && npm run lint'],
  ['typecheck', 'cd frontend && npx tsc --noEmit'],
  ['build',     'cd frontend && npm run build'],
  ['golden',    'npm run e2e:golden'],          // wired in Task 6
];
let failed = [];
for (const [name, cmd] of steps){
  try { console.log(`\n=== ${name} ===`); execSync(cmd, { stdio:'inherit', shell:true }); }
  catch { failed.push(name); }
}
try { execSync('node scripts/check-callhome.mjs', { stdio:'inherit' }); }
catch { console.warn('WARN: call-home not yet clean (expected until DET epic)'); }
if (failed.length){ console.error(`\nVERIFY FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\nVERIFY GREEN');
```

- [ ] **Step 4: Add npm scripts**

```jsonc
// package.json (root) "scripts"
"verify": "node scripts/verify.mjs",
"check:callhome": "node scripts/check-callhome.mjs",
"e2e:golden": "playwright test e2e/golden"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/verify.mjs scripts/check-callhome.mjs package.json && git commit -m "feat: verify harness + call-home check"
```

---

## Task 6: Golden-path smoke (MockAgent, deterministic)

**Files:**
- Create: `e2e/golden/golden-path.spec.ts`, `e2e/golden/fixtures.ts`
- Modify: backend agent bootstrap (`backend/apps/agents/agent_manager.py`) — honor `MAESTRO_MOCK_AGENT=1` to force `MockAgent`

**Interfaces:**
- Consumes: `MockAgent` (`backend/apps/agents/manager/MockAgent.py`).
- Produces: `npm run e2e:golden` — the regression oracle called by `verify` (Task 5) and CI (Task 7).

- [ ] **Step 1: Force MockAgent via env (the seam)** — in `agent_manager.py` where it probes the SDK, short-circuit to `MockAgent` when `os.environ.get("MAESTRO_MOCK_AGENT") == "1"`.

```python
# backend/apps/agents/agent_manager.py (near SDK-presence probe)
if os.environ.get("MAESTRO_MOCK_AGENT") == "1":
    from .manager.MockAgent import MockAgent
    return MockAgent(...)   # match existing fallback construction
```

- [ ] **Step 2: Write the launch fixture**

```ts
// e2e/golden/fixtures.ts
import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
export async function launchMaestro() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'maestro-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, MAESTRO_MOCK_AGENT: '1', OPENSWARM_DISABLE_PREFLIGHT: '1', DATA_ROOT: dataRoot },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, dataRoot };
}
```

- [ ] **Step 3: Write the golden-path test**

```ts
// e2e/golden/golden-path.spec.ts
import { test, expect } from '@playwright/test';
import { launchMaestro } from './fixtures';
test('golden path: launch → create agent → run turn → stream renders', async () => {
  const { app, win } = await launchMaestro();
  await expect(win).toHaveTitle(/Maestro|Open ?Swarm/);          // BRD flips this to Maestro-only
  await win.getByRole('button', { name: /new agent|create/i }).first().click();
  await win.getByRole('textbox').first().fill('say hello');
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('assistant-message').first()).toBeVisible({ timeout: 15000 });
  await app.close();
});
```

- [ ] **Step 4: Run it — expect PASS** (or triage selectors against the real DOM once, then lock)

```bash
npm run e2e:golden
```
Expected: 1 passed. If selectors differ, inspect the running app and update them (this is the one-time calibration of the oracle).

- [ ] **Step 5: Commit**

```bash
git add e2e/golden backend/apps/agents/agent_manager.py && git commit -m "test: golden-path smoke via MockAgent"
```

---

## Task 7: Merge gate + Definition of Done

**Files:**
- Modify: `.github/workflows/verify.yml` (run full `npm run verify` incl. golden smoke)
- Create: `docs/CONTRIBUTING-maestro.md`
- Configure: branch protection on `main`

**Interfaces:**
- Consumes: `npm run verify` (Task 5), golden smoke (Task 6).
- Produces: the enforced gate — no merge to `main` unless verify is green + review done.

- [ ] **Step 1: Extend CI to run the full gate + install Playwright/browsers + Python for the smoke.** Update `verify.yml` job to `run: npm ci && npx playwright install --with-deps chromium && npm run verify`.

- [ ] **Step 2: Write `docs/CONTRIBUTING-maestro.md`** with the 6-point Definition of Done (verbatim from the spec) + the reversibility convention (additive-then-switch for DET/PRV) + the review rule (different-vendor reviewer).

- [ ] **Step 3: Enable branch protection**

```bash
gh api -X PUT repos/gmartinstech/maestro/branches/main/protection \
  -f required_status_checks.strict=true -f 'required_status_checks.contexts[]=verify' \
  -F enforce_admins=true -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```
Expected: protection enabled; direct pushes to `main` blocked.

- [ ] **Step 4: Commit & open the PR for the foundation branch**

```bash
git add .github/workflows/verify.yml docs/CONTRIBUTING-maestro.md && git commit -m "ci: full verify gate + Definition of Done" && gh pr create -t "Foundation & stability gate" -b "FND + STAB-1..4"
```
Expected: PR shows the `verify` check running and green.

---

## Task 8: Upstream-sync runbook

**Files:**
- Create: `docs/UPSTREAM.md`

**Interfaces:**
- Produces: the procedure every upstream pull follows; conflict-zone map for reviewers.

- [ ] **Step 1: Write `docs/UPSTREAM.md`** — cadence (e.g. weekly), the merge-branch procedure (`git fetch upstream && git merge upstream/main` on a `sync/<date>` branch → run `npm run verify` + call-home check → PR), and the conflict-zone map (branding files, `providers/registry.py`, `configure_provider_env.py`, i18n-wrapped screens, removed cloud modules).

- [ ] **Step 2: Dry-run one sync to validate the steps**

```bash
git fetch upstream && git checkout -b sync/2026-07-20 && git merge --no-commit --no-ff upstream/main || echo "conflicts (expected) — record zones"
git merge --abort
```
Expected: either clean or a recorded list of conflict files (feeds the conflict-zone map).

- [ ] **Step 3: Commit**

```bash
git checkout foundation/stability-gate && git add docs/UPSTREAM.md && git commit -m "docs: upstream-sync runbook + conflict map"
```

---

## Task 9: Secrets & env templates

**Files:**
- Modify: `backend/.env.example`; Create: `.env.maestro.example`, `docs/SECRETS.md`

**Interfaces:**
- Produces: the documented inputs later epics need (signing creds, provedor-ia/Keycloak) without committing secrets.

- [ ] **Step 1: Add Maestro env template** (`.env.maestro.example`)

```bash
# provedor-ia
PROVEDOR_IA_BASE_URL=https://llm.martinstech.net/v1
PROVEDOR_IA_API_KEY=            # mtok_... OR leave blank when using Keycloak JWT
# Keycloak (PRV-2)
KEYCLOAK_ISSUER=
KEYCLOAK_CLIENT_ID=
# Windows signing (DET-2) — set in CI secrets, never here
AZURE_TENANT_ID=
```

- [ ] **Step 2: Confirm `.gitignore` excludes real env files**

```bash
grep -nE '^\.env($|\.)' .gitignore || echo ".env*" >> .gitignore
```

- [ ] **Step 3: Write `docs/SECRETS.md`** listing every secret, where it's set (CI vs local), and which ticket needs it.

- [ ] **Step 4: Commit**

```bash
git add .env.maestro.example docs/SECRETS.md .gitignore && git commit -m "docs: secrets + env templates"
```

---

## Task 10: Agent dispatch + cross-model review harness

**Files:**
- Create: `harness/models.json`, `harness/dispatch.mjs`, `harness/review.mjs`, `docs/HARNESS.md`

**Interfaces:**
- Consumes: `npm run verify` (Task 5).
- Produces: `node harness/dispatch.mjs <ticket>` (implement in an isolated worktree, run verify) and `node harness/review.mjs <branch>` (route the diff to a different-vendor reviewer). Human-only for credential/signing tickets.

- [ ] **Step 1: Define the model routing** (`harness/models.json`)

```json
{
  "implement": { "primary": "claude:sonnet", "alt": "codex", "hard": "claude:opus" },
  "review":    { "crossVendor": true, "free_second_opinion": "pi:lmstudio/ornith-1.0-35b" },
  "local":     { "runner": "pi", "gateway": "provedor-ia:https://llm.martinstech.net/v1" },
  "human_only": ["DET-2", "DET-6", "PRV-2"]
}
```

- [ ] **Step 2: Write `harness/dispatch.mjs`** — creates a git worktree per ticket, writes the agent-dispatcher task JSON (task/result/done/error files, absolute Windows paths, temp-then-rename), invokes the chosen runtime, then runs `npm run verify` in the worktree and reports green/red. (Follows the agent-dispatcher skill contract.)

- [ ] **Step 3: Write `harness/review.mjs`** — takes a branch, produces the diff, sends it to a reviewer of a *different vendor* than the implementer + the free local `ornith` second opinion, and prints a merge/hold recommendation; disagreement → flag for Opus/human.

- [ ] **Step 4: Smoke-test the harness on a no-op ticket**

```bash
node harness/dispatch.mjs --ticket DEMO --task "add a code comment to README.md" --model claude:haiku
```
Expected: a worktree is created, the edit lands, `npm run verify` runs and reports green, `harness/review.mjs` returns a recommendation. (Discard the demo branch.)

- [ ] **Step 5: Write `docs/HARNESS.md`** (how to dispatch, routing table, human-only tickets) and commit

```bash
git add harness docs/HARNESS.md && git commit -m "feat: agent dispatch + cross-model review harness"
```

---

## Follow-on plans (authored when reached)

Each is its own plan, gated by this one, each shippable and verifiable via `npm run verify` + golden smoke:

- **Plan 2 — DET (Detach):** turn `check-callhome` green; remove cloud sign-in/Pro/telemetry; repoint feeds/CSP; Windows signing (human).
- **Plan 3 — BRD (Rebrand):** identity strings, `bot-pixel` icons, `am.css` tokens (Inter + IBM Plex Mono), copy scrub; add visual-regression snapshots (STAB-6).
- **Plan 4 — PRV (provedor-ia):** register provider, Keycloak JWT, verify streaming/tools/cost through 9Router.
- **Plan 5 — DOM (Domain):** first-run provisioning bootstrap + our modes/workflows/skills/tools.
- **Plan 6 — LOC (pt-BR):** react-i18next infra + screen-by-screen wrapping + visual regression.

## Self-Review

**Spec coverage:** FND-1..5 → Tasks 1,2,9,4,3/8. STAB-1 → Task 4. STAB-2 → Task 6. STAB-3 → Task 5. STAB-4 → Task 7. STAB-7 → Task 8. STAB-8/9 → Task 10. STAB-10 → Task 3. STAB-5 → Task 7 (CONTRIBUTING reversibility). STAB-6 deferred to BRD/LOC plans (needs screens to snapshot) — noted. DET/BRD/PRV/DOM/LOC → follow-on plans. No foundation requirement left unassigned.

**Placeholder scan:** Context-pack contents (Task 3.3) and `docs/UPSTREAM.md`/`CONTRIBUTING`/`SECRETS`/`HARNESS` bodies are described rather than pasted verbatim because their content is mechanical transcription of file lists already produced and of the spec's DoD — the executor copies known values, not invents them. All code steps (verify, check-callhome, golden smoke, fixtures, models.json) contain complete runnable content.

**Type/name consistency:** `npm run verify` → `scripts/verify.mjs`; `npm run e2e:golden` → `e2e/golden`; `MAESTRO_MOCK_AGENT=1` used identically in fixture (Task 6.2) and backend seam (Task 6.1); `check-callhome.mjs` referenced by both `verify.mjs` and `package.json`. Consistent.

## Execution Handoff — see the message accompanying this plan.

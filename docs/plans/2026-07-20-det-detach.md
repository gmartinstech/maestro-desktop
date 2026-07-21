# DET — Detach from openswarm-ai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Maestro Studio call **zero** openswarm-ai infrastructure — repoint updates/build to our repo, rip out the cloud login / "Pro" proxy / Stripe / telemetry, fix the renderer CSP/CORS, and vendor the app-builder template — so `node scripts/check-callhome.mjs` exits 0 and the golden-path smoke still passes.

**Architecture:** The app already runs cloud-less in the default `own_key` mode; the cloud paths are inert branches + optional UI + baked-in URLs. This plan is mostly **deletion and repointing**, not new logic. The `check-callhome` gate (electron + built renderer must contain no `*.openswarm.com`) is the north star; the golden smoke proves nothing broke.

**Tech Stack:** Electron (main.js), React/TS (frontend), FastAPI/Python (backend), electron-builder, GitHub releases.

## Global Constraints

- Repo `gmartinstech/maestro-desktop`; product "Maestro Studio"; appId `net.martinstech.maestro.studio`.
- Zero calls to `*.openswarm.com`. Models come only from provedor-ia (`https://llm.martinstech.net/v1`).
- The renderer CSP MUST include `https://llm.martinstech.net` (+ the Keycloak host) or renderer→provedor-ia calls are blocked. Backend→provedor-ia calls are server-side (not CSP-bound).
- Retain `LICENSE` (© Haik Decie). Windows-first. Node.js required (9Router).
- Every task closes against the **Definition of Done** (`docs/CONTRIBUTING-maestro.md`): app builds + launches; golden smoke passes; `check-callhome` not worse than before (green by end); no NEW openswarm-ai calls; diff reviewed by a **different-vendor model** — run `node harness/review.mjs --base main --head HEAD` (uses `ollama run deepseek-v4-flash:cloud`) and merge only on `VERDICT: APPROVE`.
- Prereq: Plan 1 merged (verify harness, check-callhome, golden smoke, review harness all on `main`).

## Model / Execution routing

- **Implement:** Sonnet (multi-file deletions + import cleanup) or Haiku (single-file repoints). One ticket per branch.
- **Review:** `node harness/review.mjs` (cloud Ollama, non-Claude) on every diff; disagreement → Opus/human.
- **Human-only:** Task 8 (Windows signing — credentials) and Task 9's macOS half (deferred).

---

## File Structure

Touched (from the detachment inventory — exact anchors):
- `electron/package.json` — `build.publish` owner/repo (:191-195), `squirrelWindows.iconUrl` (:130), electron-download mirror (:39-41).
- `electron/main.js` — `setFeedURL` (:1548), analytics URL (:934-935), affiliate handshake call (:1987), update-error copy (:2979).
- `electron/affiliateTracking.js` — install attribution.
- `electron/preflight.js` — health probe (:134,161).
- `backend/main.py` — CORS origins (:90-91).
- `backend/apps/auth/*`, `backend/apps/subscription/*` — cloud identity + billing SubApps.
- `backend/apps/agents/manager/configure_provider_env.py` — Pro proxy lane (:161-180).
- `backend/apps/agents/proxy/anthropic_proxy.py` (:353-358), `backend/apps/agents/agents.py` (:557-562), `backend/apps/settings/credentials.py` (:11,17-28) — Pro branches + default proxy URL.
- `backend/apps/tools_lib/oauth_config.py` (:13-14) — MCP OAuth broker base URL.
- `frontend/public/index.html` — CSP (:20,26), preconnect (:37-38).
- `frontend/src/shared/config.ts` — `OPENSWARM_DEFAULT_PROXY_URL` (:14).
- `frontend/src/shared/subscription/checkout.ts` (:42), `.../Settings/sections/subscription/*`, `PlanPicker*`, `AccountCard.tsx`, `SignInDialog.tsx` — billing/sign-in UI.
- `scripts/fetch-webapp-template.sh` (:17) — template source.
- `scripts/build-app-win.ps1` (:29,517,563), `scripts/build-app.sh`, `.env.windows.example` — build/publish/signing.
- `scripts/check-callhome.mjs` — broaden to also scan `frontend/src` + `backend` for `openswarm.com` (source-level), so detach is verifiable without a full build.

---

## Task 1: Repoint auto-update + publish to our repo (DET-1)

**Files:**
- Modify: `electron/main.js:1548`; `electron/package.json:130,191-195`; `scripts/build-app-win.ps1:29,517,563`

**Interfaces:**
- Produces: no openswarm-ai release URLs anywhere; updater points at `gmartinstech/maestro-desktop`.

- [x] **Step 1: Repoint the Squirrel feed** — `electron/main.js:1548`

```js
autoUpdater.setFeedURL({ url: 'https://github.com/gmartinstech/maestro-desktop/releases/latest/download/' });
```

- [x] **Step 2: Repoint the electron-builder publish block** — `electron/package.json` `build.publish`

```json
"publish": { "provider": "github", "owner": "gmartinstech", "repo": "maestro-desktop" }
```

- [x] **Step 3: Repoint the Squirrel icon URL** — `electron/package.json:130` and `scripts/build-app-win.ps1:29`

```
https://raw.githubusercontent.com/gmartinstech/maestro-desktop/main/electron/build/icon.ico
```

- [x] **Step 4: Repoint the Windows publish targets** — in `scripts/build-app-win.ps1` change the `--repo openswarm-ai/openswarm` (:563) and the `latest-mac.yml` HEAD-check URL (:517) to `gmartinstech/maestro-desktop`.

- [x] **Step 5: Verify — no openswarm-ai release refs remain**

Run: `grep -rn "openswarm-ai/openswarm" electron scripts` — Expected: no matches.

- [x] **Step 6: Review + commit**

Run: `node harness/review.mjs --base main --head HEAD` → expect `VERDICT: APPROVE`.
```bash
git add electron/main.js electron/package.json scripts/build-app-win.ps1
git commit -m "feat(det): repoint auto-update + publish to gmartinstech/maestro-desktop"
```

---

## Task 2: Remove telemetry, analytics & affiliate tracking (DET-5)

**Files:**
- Modify: `electron/main.js:935,1987`; Remove/neutralize: `electron/affiliateTracking.js`; guard `backend/apps/service/client.py:37,212-219`

**Interfaces:**
- Produces: no outbound analytics/affiliate; `analytics.openswarm.com` gone from electron.

- [ ] **Step 1: Delete the first-launch affiliate handshake** — remove the `maybeRunFirstLaunchHandshake(...)` call at `electron/main.js:1987`; keep the local-only `resolveInstallId()` (main.js:952).

- [ ] **Step 2: Neutralize the analytics endpoint** — `electron/main.js:935`: delete the line that sets `OPENSWARM_ANALYTICS_URL = 'https://analytics.openswarm.com'` (it then defaults to localhost:6792 → no-op). 

- [ ] **Step 3: Remove the affiliate module usage** — delete `electron/affiliateTracking.js` and any import of it in `main.js`.

- [ ] **Step 4: Disable the service-sync forwarder** — `backend/apps/service/client.py`: make `p_base_url` / the POST forwarder a no-op unless an explicit `MAESTRO_TELEMETRY_URL` env is set (default off). Do not forward to `api.openswarm.com`.

- [ ] **Step 5: Verify**

Run: `grep -rn "analytics.openswarm\|affiliateTracking\|api.openswarm.com" electron backend/apps/service` — Expected: no live references (only comments/tests acceptable).
Run: `node scripts/check-callhome.mjs` — Expected: fewer hits than the baseline 8.

- [ ] **Step 6: Golden smoke + review + commit**

Run: `npm run e2e:golden` (on a machine with the build) → PASS. `node harness/review.mjs --base main --head HEAD` → APPROVE.
```bash
git add -A && git commit -m "feat(det): remove analytics, affiliate, and cloud telemetry forwarder"
```

---

## Task 3: Remove the "OpenSwarm Pro" proxy, Stripe & free-trial (DET-4)

**Files:**
- Remove: `frontend/src/shared/subscription/checkout.ts`, `.../Settings/sections/subscription/*` (PlanPicker*, OpenSwarmProCard, SubscriptionCard*), the `subscription` SubApp mount
- Modify: `backend/apps/agents/manager/configure_provider_env.py:161-180`; `backend/apps/agents/proxy/anthropic_proxy.py:353-358`; `backend/apps/agents/agents.py:557-562`; `backend/apps/settings/credentials.py:11,17-28`; `frontend/src/app/Main.tsx:222`

**Interfaces:**
- Consumes: default `connection_mode = own_key` (models.py:74) is the only mode now.
- Produces: no `openswarm-pro`/`free-trial` code paths; no Stripe.

- [ ] **Step 1: Disable free-trial by default** — `backend/apps/subscription/free_trial.py:35` default `OPENSWARM_FREE_TRIAL_ENABLED=0`; remove the launch arming at `frontend/src/app/Main.tsx:222`.

- [ ] **Step 2: Remove the Pro proxy branch** — in `configure_provider_env.py` delete the `connection_mode in (openswarm-pro, free-trial)` lane (:161-180); likewise the guarded branches in `anthropic_proxy.py:353-358` and `agents.py:557-562`, and the proxy modes in `credentials.py`.

- [ ] **Step 3: Remove billing UI** — `git rm` the checkout + plan-picker + subscription-card components and unmount the `subscription` SubApp; remove their imports/routes.

- [ ] **Step 4: Verify the app still starts in own_key mode**

Run: `grep -rn "openswarm-pro\|stripe\|api.openswarm.com/api/stripe" frontend/src backend/apps` — Expected: no live references.

- [ ] **Step 5: Golden smoke + review + commit**

Run: `npm run e2e:golden` → PASS (agent still runs via MockAgent). `node harness/review.mjs` → APPROVE.
```bash
git add -A && git commit -m "feat(det): remove Pro proxy, Stripe checkout, and free-trial"
```

---

## Task 4: Remove the optional cloud sign-in (DET-3)

**Files:**
- Remove: `backend/apps/auth/*` SubApp mount; sign-in UI (`.../Settings/.../AccountCard.tsx`, `SignInDialog.tsx`)

**Interfaces:**
- Produces: no `api.openswarm.com/api/auth/*` calls; account UI gone; app still boots (login was never required).

- [ ] **Step 1: Drop the auth SubApp** — remove the `auth` mount from `backend/config/Apps.py` and delete/neutralize `backend/apps/auth/router.py` (Google/magic-link/signin-activate/signout all target the cloud).

- [ ] **Step 2: Remove sign-in UI** — `git rm` `AccountCard.tsx` + `SignInDialog.tsx`; remove their imports and any "Sign in" entry points; leave settings otherwise intact.

- [ ] **Step 3: Verify**

Run: `grep -rn "api.openswarm.com/api/auth\|signin-activate\|SignInDialog" frontend/src backend/apps` — Expected: none live.

- [ ] **Step 4: Golden smoke + review + commit**

Run: `npm run e2e:golden` → PASS. `node harness/review.mjs` → APPROVE.
```bash
git add -A && git commit -m "feat(det): remove optional openswarm-cloud sign-in"
```

---

## Task 5: Repoint endpoints, CSP & CORS (DET-8)

**Files:**
- Modify: `frontend/public/index.html:20,26,37-38`; `backend/main.py:90-91`; `frontend/src/shared/config.ts:14`; `backend/apps/tools_lib/oauth_config.py:13-14`; `electron/preflight.js:134,161`

**Interfaces:**
- Produces: renderer allowed to reach provedor-ia + Keycloak; no `*.openswarm.com` in CSP/CORS/defaults.

- [ ] **Step 1: Fix the renderer CSP** — `frontend/public/index.html`: in `default-src`/`connect-src` remove `https://*.openswarm.com https://api.openswarm.com https://openswarm.com` and ADD `https://llm.martinstech.net` and your Keycloak origin. Remove the `api.openswarm.com` preconnect/dns-prefetch lines (:37-38).

- [ ] **Step 2: Fix backend CORS** — `backend/main.py:90-91`: remove the `api.openswarm.com` and `openswarm.com` origins; keep localhost/file:// (the app binds 127.0.0.1).

- [ ] **Step 3: Repoint default proxy/oauth URLs** — `frontend/src/shared/config.ts:14` `OPENSWARM_DEFAULT_PROXY_URL` → remove or set to our host; `backend/apps/tools_lib/oauth_config.py:13-14` `OPENSWARM_OAUTH_BASE_URL` default → our host (see Task 6) or unset.

- [ ] **Step 4: Disable the preflight cloud probe** — `electron/preflight.js:134,161`: repoint to our host, or set `OPENSWARM_DISABLE_PREFLIGHT=1` in the packaged env.

- [ ] **Step 5: Verify (source-level)**

Run: `grep -rn "openswarm.com" frontend/public frontend/src backend/main.py` — Expected: none.

- [ ] **Step 6: Golden smoke + review + commit**

`node harness/review.mjs` → APPROVE.
```bash
git add -A && git commit -m "feat(det): repoint CSP/CORS/defaults to provedor-ia; drop openswarm.com"
```

---

## Task 6: MCP-tool OAuth broker — scope decision (DET-10)

**Files:**
- Modify: `backend/apps/tools_lib/oauth_config.py:13`; `backend/apps/discord_mcp_shim/server.py:18`; `mcp_config.py:143`

**Interfaces:**
- Produces: either our own broker host, or the social/workspace connectors disabled (core agent + provedor-ia unaffected either way).

- [ ] **Step 1: Decide (record in the PR):** For the internal MVP, **disable** the third-party social/workspace MCP connectors (Google/Discord/etc.) that broker OAuth via `api.openswarm.com`, rather than standing up a broker now.

- [ ] **Step 2: Implement the decision** — hide/disable those curated integrations in the Tools UI and leave `OPENSWARM_OAUTH_BASE_URL` unset (connectors that need it are off). Do NOT leave it defaulting to `api.openswarm.com`.

- [ ] **Step 3: Verify** — Run: `grep -rn "api.openswarm.com" backend/apps/tools_lib backend/apps/*_mcp_shim` — Expected: no live default to the cloud broker.

- [ ] **Step 4: Review + commit** — `node harness/review.mjs` → APPROVE.
```bash
git add -A && git commit -m "feat(det): disable cloud-brokered MCP connectors for MVP"
```

---

## Task 7: Vendor the app-builder template (DET-7)

**Files:**
- Modify: `scripts/fetch-webapp-template.sh:17`

**Interfaces:**
- Produces: the App-Builder feature has no openswarm-ai clone dependency.

- [ ] **Step 1: Point the fetch at our source** — `scripts/fetch-webapp-template.sh:17`: change the `git clone openswarm-ai/webapp-template` to our fork `gmartinstech/webapp-template` (create the fork first), OR rely solely on the already-committed snapshot under `backend/apps/outputs/webapp_template/` and make the script a no-op when the snapshot exists.

- [ ] **Step 2: Verify** — Run: `grep -rn "openswarm-ai/webapp-template" scripts` — Expected: none.

- [ ] **Step 3: Review + commit** — `node harness/review.mjs` → APPROVE.
```bash
git add scripts/fetch-webapp-template.sh && git commit -m "feat(det): vendor webapp-template, drop openswarm-ai clone"
```

---

## Task 8: Signing under our identity (DET-2) — HUMAN

**Files:**
- Modify: `electron/build/sign-windows.js`; `.env.windows.example:6-11`; `.github/workflows/release-windows.yml`

**Interfaces:**
- Produces: Windows installers signed with our certificate; no `mist-code-signing` defaults.

- [ ] **Step 1 (human):** Stand up our Azure Trusted Signing account/profile (or obtain an OV/EV cert). Replace the `AZURE_SIGNING_ACCOUNT=mist-code-signing` / `AZURE_SIGNING_CERT_PROFILE=Mist-Windows-Signing` defaults in `.env.windows.example` and CI secrets. If using a cert+signtool instead, swap the `sign-windows.js` hook accordingly.

- [ ] **Step 2 (human):** Populate the signing secrets in the `gmartinstech/maestro-desktop` repo (see `docs/SECRETS.md`). macOS signing (DET-6) is deferred until a Mac target is needed.

- [ ] **Step 3: Verify** — a tagged CI build produces a signed `Maestro Studio-Setup-x64.exe`. (Runs in CI, not locally.)

---

## Task 9: Widevine decision (DET-9)

**Files:**
- Modify: `electron/build/after-pack.js:24-60`; `electron/scripts/sign-vmp.js`; `electron/package.json:10`

**Interfaces:**
- Produces: build needs no castlabs EVS account.

- [ ] **Step 1: Disable VMP signing** — set `VMP_REQUIRE_SIGN=0` and skip the `sign-vmp` postinstall/after-pack step, so no EVS credentials are required. Keep the castlabs electron fork (`electron/package.json:39-41`) for now (harmless); revisit only if DRM playback is actually needed.

- [ ] **Step 2: Verify** — Run: `grep -rn "EVS_ACCOUNT_NAME\|EVS_PASSWD" scripts electron | grep -v example` — Expected: no hard requirement; build proceeds unsigned-VMP.

- [ ] **Step 3: Review + commit** — `node harness/review.mjs` → APPROVE.
```bash
git add -A && git commit -m "feat(det): disable Widevine VMP signing (no EVS dependency)"
```

---

## Task 10: Turn check-callhome green + prove zero call-home (DET acceptance / SEC-1)

**Files:**
- Modify: `scripts/check-callhome.mjs` (broaden scan to `frontend/src` + `backend`)

**Interfaces:**
- Consumes: Tasks 1-7 completed.
- Produces: `node scripts/check-callhome.mjs` exits 0; a network capture confirms no openswarm-ai traffic at runtime.

- [ ] **Step 1: Broaden the scan** — extend `ROOTS` in `check-callhome.mjs` to also walk `frontend/src` and `backend` (source-level), not just built output, so detachment is verifiable pre-build.

- [ ] **Step 2: Run the full gate**

Run: `npm run verify` (on the dev machine: installs + build + golden smoke + check-callhome). Expected: `VERIFY GREEN` and `call-home check: clean`.

- [ ] **Step 3: Runtime proof** — launch the packaged app with a network capture (or `netsh trace` / a proxy) and exercise a MockAgent turn; confirm **no** requests to any `*.openswarm.com` host.

- [ ] **Step 4: Review + commit + open the DET PR**

`node harness/review.mjs --base main --head HEAD` → APPROVE.
```bash
git add scripts/check-callhome.mjs && git commit -m "feat(det): check-callhome scans source; detachment complete"
gh pr create --repo gmartinstech/maestro-desktop --base main --head plan/det-detach --title "DET: detach from openswarm-ai"
```

---

## Self-Review

**Spec coverage:** DET-1→T1, DET-2→T8, DET-3→T4, DET-4→T3, DET-5→T2, DET-6→T8 (deferred note), DET-7→T7, DET-8→T5, DET-9→T9, DET-10→T6. Acceptance (check-callhome green + zero runtime call-home)→T10. All DET tickets covered.

**Placeholder scan:** Concrete anchors + exact replacement values (feed URL, publish block, icon URL, CSP hosts, env flags) are given. Deletion tasks name exact files + the verifying grep. No "add error handling"-style vagueness.

**Consistency:** Every task verifies via `check-callhome` and/or a targeted `grep`, plus `node harness/review.mjs` (the Plan-1 tool) before commit — consistent gate throughout. `own_key` is the single remaining connection mode after T3, which T4/T5 rely on.

**Sequencing note:** T5 (CSP add provedor-ia) should land before real provider traffic (PRV plan) but after T3/T4 remove the cloud proxy; T10 is the closing acceptance gate.

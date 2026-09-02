# TXM — Tauri + TypeScript Migration Plan (Electron/Python → Tauri 2 / TS, Win·mac·Android·iOS)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement ticket-by-ticket. Steps use checkbox (`- [ ]`) syntax for tracking. **Phases CTR → AGT are fully specified here. Phases SUB, RMT, MAC, MOB, REL, CUT are specified to ticket + gate granularity; each gets its own expanded plan doc in `docs/plans/` before it is executed** (same pattern as DET → BRD → PRV).

**Goal:** Replace the Electron desktop shell with Tauri 2 and the FastAPI/Python backend with a TypeScript engine, shipping Windows, macOS, Android and iOS — without ever leaving `main` unreleasable for the existing Electron+Python stack, and without regressing the fork's licence/branding/no-call-home constraints.

**Architecture (the one insight the whole plan rests on):** Maestro Studio is *already* a client/server application. `frontend/` talks to `backend/` over HTTP + WebSocket on `127.0.0.1:<port>` with a per-install bearer token (`frontend/src/shared/config.ts:12-14`, `backend/main.py:155` `@app.websocket("/ws/agents/{session_id}")`). Electron is only (a) a localhost process host, (b) a window, (c) a set of native affordances reached through 16 files that touch `window.maestro`. That HTTP+WS contract is the strangler-fig seam: freeze it, and the shell and the server can be replaced independently, in either order, one subsystem at a time.

**Tech stack (target):** Tauri 2.x (Rust core + system webview) · React/TS frontend (unchanged, **not forked**) · Node 20.18.1 TypeScript engine (sidecar on desktop, headless daemon on a paired host for mobile) · vendored 9Router (Node, unchanged) · Playwright/CDP + tauri-driver for e2e.

---

## 0. Context and decisions

### D0 — macOS is back in scope. This reverses `docs/HANDOFF.md` §10.

`docs/HANDOFF.md:111-145` records a product-owner decision: *"macOS is not a target. Do not revive it."* The entire mac pipeline was **deleted, not disabled** — `release-macos.yml`, `publish.sh`, `scripts/build-app.sh`, `scripts/build-test-dmg.sh`, `scripts/build-python-env.sh`, `electron/scripts/**` (notarize.js, sign-vmp, build-mouseclamp.sh), `electron/native/mouseclamp/**`, `entitlements.mac*.plist`, the `mac`/`dmg` electron-builder blocks, the `@electron/notarize` devDependency, and the WebAuthn keychain access group.

**That decision is reversed for this migration.** macOS ships alongside Windows, Android and iOS.

**Treat macOS as new work, not as an undo.** Nothing is resurrected: the deleted assets were Electron-specific (electron-builder mac blocks, an `afterSign` notarize hook, an Objective-C `mouseclamp` addon for an Electron cursor crash, a castlabs VMP signing step for Widevine). Tauri's bundler notarizes natively, has no VMP concept, and the mouseclamp crash does not exist outside Electron. Phase **MAC** builds a macOS target from zero against Tauri; it does not `git revert` anything.

Consequence for `docs/UPSTREAM.md`: "upstream mac commits are categorically out of scope for cherry-picking" (HANDOFF §10 final line) **remains true** — upstream is still Electron, so their mac commits are still irrelevant to us. Do not relax `scripts/check-fork-drift.mjs`'s `ALLOW_STRINGS` (the Apple keychain access group stays forbidden; if macOS ever needs WebAuthn, it gets a MartinsTech team ID, never upstream's `Y26NUZH4NG`).

### D1 — Mobile execution model: **thin remote client against a paired engine.** (RECOMMENDED DEFAULT)

This is the single biggest architectural driver and it must not be fudged.

**The problem.** Tauri's mobile runtime does not support arbitrary child-process spawning. `tauri-plugin-shell`'s `Command`/sidecar API and `externalBin` bundling are **desktop-only**. The current backend's entire job is spawning subprocesses:

- `claude-agent-sdk==0.1.70` (`backend/requirements.txt:11`) — spawns the bundled Claude Code CLI (Node) per turn; used in 20 files including `backend/apps/agents/manager/run/TurnRunner.py:46`.
- 9Router — a bundled Node server spawned by `backend/apps/nine_router/process.py:734`.
- The app-builder runtime — `backend/apps/outputs/runtime_proc.py`, `executor.py`, `runtime.py` spawn `npm install`, Vite, uvicorn.
- MCP servers — `backend/mcp-bundles/**` (Node) spawned via `backend/apps/tools_lib/mcp_discovery.py`.
- The terminal — ConPTY via `pywinpty` (`backend/apps/terminal/pty_backend.py`).
- git, and whatever the agent shells out to.

None of that can run on iOS. Apple App Store §2.5.2 forbids downloading and executing code; iOS forbids JIT and arbitrary `fork/exec` for App Store apps. Android is technically more permissive but still has no Node runtime, no git, no writable `PATH` of CLIs, and a hostile process lifecycle.

**Decision: on mobile, "the app" is the Maestro Studio *client*. It renders sessions, drives turns, approves permission gates, reads transcripts and outputs, and manages settings — against an engine running on a machine the user owns.** Two supported engine locations, both single-tenant and user-owned:

1. **Paired desktop** — the user's Windows/macOS Maestro Studio, reachable on LAN or over a private overlay network (Tailscale/WireGuard). Default and recommended.
2. **Self-hosted headless engine** — `engine/` running under Node on the user's own box (they already operate the `cloudinha` VPS; see `docs/RELEASE_RUNBOOK.md`).

There is **no MartinsTech-operated multi-tenant service**. That is deliberate: `docs/HANDOFF.md:31` records "multi-tenant SaaS was explicitly dropped", and building one would re-introduce exactly the cloud coupling the DET epic removed and `scripts/check-callhome.mjs` now guards.

**Offline degradation on mobile is explicit, not accidental:** with no reachable engine, the mobile app is read-only over a local cache (browse past sessions, read transcripts and outputs). Anything that runs a turn shows a "no engine paired" state. Never a spinner, never a silent failure.

**Alternatives considered and rejected:**

| Option | Why rejected |
|---|---|
| On-device agent via WASM/WASI | The product *is* subprocess orchestration over a real git worktree. WASI sandboxes away precisely the capabilities that constitute the feature: spawn, PATH, a real filesystem, raw sockets. You would ship a compiler toolchain to obtain an agent that can do nothing the user wants. |
| Compile the engine to a native mobile binary and run agents in-process | Does not help. The blocker is not "can Rust/TS run on the phone" — it is that Claude Code / Codex are *external CLIs* and there is no legal way to ship and exec them on iOS. |
| Cloud-hosted multi-tenant engine operated by MartinsTech | Contradicts HANDOFF §1; re-introduces cloud identity/billing/call-home; makes `check-callhome` a lie; unbounded operational cost for a desktop product. |
| "Mobile is a viewer only, no turn control" | Under-delivers. Approving a permission gate and sending a follow-up prompt from a phone is the whole reason to want mobile, and both are just WS messages — they cost nothing once the client is remote-capable. |
| Ship mobile last / never | Not an option; it is in the brief. But note this plan **sequences it last among the platforms** (phase MOB) precisely because it depends on RMT, which depends on the engine existing. |

**The load-bearing consequence:** phase **RMT** (make the client engine-location-agnostic: configurable base URL, pairing, transport auth) is not a mobile nicety — it is the mobile enabler, it is entirely desktop-testable, and it must land before any mobile shell work starts. It is also independently valuable on desktop (headless engine on a beefy workstation, thin client on a laptop).

### D2 — Runtime split: **Rust core + Node/TypeScript sidecar. No Rust backend rewrite. No Bun/Deno. No WASM.** (RECOMMENDED DEFAULT)

The brief asks to avoid "dragging in a full Node runtime as a mandatory sidecar if it can be avoided." **It cannot be avoided, and it is already paid for.**

What the packaged Windows app ships **today** (`electron/package.json` `build.extraResources`, lines 90-135):

| Payload | Why |
|---|---|
| Electron (castlabs fork, v42.3.3) | the shell |
| `build-staging/python-env` — Python 3.13.2 standalone + hash-locked deps | the backend |
| `build-staging/node/${arch}` — Node **20.18.1** | 9Router, MCP servers, Claude Code CLI |
| `build-staging/router` — 9Router (Next.js standalone) | subscription provider proxy |
| `build-staging/backend` | 71k LOC Python |
| `build-staging/uv-bin/${arch}` | Python env bootstrapping |
| `backend/mcp-bundles/**` | vendored Node MCP servers |

Node is **already mandatory** and already bundled. Rewriting the backend in Rust would not remove it — the Claude Code CLI is Node, 9Router is Node, the MCP bundles are Node. It would *add* Rust while keeping Node, and orphan the one thing that makes the port tractable: `@anthropic-ai/claude-agent-sdk`, the first-party TypeScript twin of the `claude-agent-sdk` the loop is written against today.

So the lightweight win is not "no Node." It is:

```
  removed:  Electron/Chromium runtime   (~150 MB)
  removed:  bundled Python 3.13 env      (~120 MB, plus uv-bin, plus the
            build-python-env-win.ps1 / strip-py-to-pyc.ps1 / zip-python-stdlib.ps1
            build machinery)
  added:    Tauri Rust core binary       (~8-15 MB; webview is the OS's)
  kept:     Node 20.18.1                 (already there, now also runs the engine)
```

**Allocation rule (D2a) — the rule that decides every "Rust or TS?" argument for the rest of this migration:**

> **If a headless engine on a VPS with no GUI needs it, it lives in TypeScript (`engine/`). If only the local user interface needs it, it lives in Rust (`tauri/`).**

This falls straight out of D1: the engine must run standalone for the mobile/remote story, so it cannot depend on the Tauri core.

| Concern | Home | Note |
|---|---|---|
| Window, tray, menu, titlebar overlay, splash, deep links (`maestro://`), single-instance, native dialogs, `openExternal` | Rust (`tauri/`) | replaces `electron/main.js` window/menu/deeplink code |
| Updater (desktop) | Rust — `tauri-plugin-updater` | replaces `electron-updater` + `electron/cdnUpdater.js` |
| Sidecar spawn/supervision, crash watchdog, restart policy | Rust | direct port of `electron/backendRestartPolicy.js` + `crash-watchdog.js` |
| Agent loop, providers, settings, workflows, outputs, skills, tools, swarm, terminal, MCP, 9Router supervision | TypeScript (`engine/`) | a VPS-hosted engine needs all of it |
| OS credential store (Keycloak refresh token) | TypeScript, with encrypted-file fallback | headless engine needs it; see ENG-4 |
| PTY | TypeScript | headless engine serves terminals to a remote client; see SUB-6 |
| WASM | **nowhere** | rejected; see D1 table |

**Bun/Deno rejected:** Node 20.18.1 is already pinned, already bundled, already the runtime the Claude Code CLI and every MCP bundle are validated against (`docs/RELEASE_RUNBOOK.md` "What is pinned"). Adding a second JS runtime would mean two runtimes in the bundle or re-qualifying the entire MCP/CLI surface against Bun's Node-compat layer for a startup-time win that a long-lived daemon does not care about. Revisit only if Node's single-executable-application output proves unshippable.

### D3 — Browser subsystem: **drive an external Chromium over CDP and stream screencast frames.** (RECOMMENDED DEFAULT)

The second-biggest architectural blocker, and the one most likely to be discovered late and hurt.

**Today's topology** (verified, and better than feared):

```
backend/apps/agents/browser/browser_agent.py:270,301
   → ws_manager.send_browser_command(...)      [WS, transport-agnostic]
   → frontend/src/shared/browserCommandHandler.ts
   → <webview> tag + window.maestro.sendCdpCommand
   → electron/preload.js → electron/main.js:3439 → electron/cdp-routes.js
        (BrowserView/webContents + Chrome DevTools Protocol)

separately:
electron/main.js:3025 connectMainBridge()  ← ws://127.0.0.1:<port>/ws/electron-main
   → electron/hiddenBrowser.js  (offscreen BrowserWindow for browser_fetch / browser_search)
```

The **backend half is already transport-agnostic** — it emits commands over the WS and awaits results. The Electron coupling is confined to `electron/{main.js,preload.js,webview-preload.js,cdp-routes.js,hiddenBrowser.js}` and the frontend's `browserRegistry.ts` / `BrowserCard.tsx` / `browserCommandHandler.ts`. That is why **BRW is a shell+frontend phase that is independent of the backend port** and can land early.

**Why the obvious Tauri answers do not work:**
- Tauri has no `<webview>` tag. Its multiwebview API is behind the `unstable` feature flag and is desktop-only.
- WKWebView (macOS/iOS) has **no CDP at all** — only Web Inspector, which is not programmable.
- WebView2 (Windows) *can* speak CDP via additional browser args, but building the browser agent on a Windows-only capability would strand macOS and mobile permanently.

**Decision: move browser automation out of the app's own webview entirely.** The engine (or Rust core on desktop) launches a **separate Chromium** with `--remote-debugging-port` and drives it over CDP. The UI's "browser card" stops being a live embedded webview and becomes a canvas fed by CDP `Page.startScreencast` frames, with input events posted back as `Input.dispatchMouseEvent`/`dispatchKeyEvent`.

Browser binary resolution, in order: **system Microsoft Edge** (guaranteed present on Windows 10/11) → **system Google Chrome** (typical on macOS) → **lazily downloaded Chromium on first use** (never bundled — bundling would undo the whole lightweight point).

Why this is the right call and not a compromise:
- One implementation for Windows and macOS, identical code path.
- It is the *only* model that works for mobile — a phone cannot host the automated browser, but it can render screencast frames arriving over the same WS it already uses. Mobile gets browser-agent viewing and control for free.
- It deletes `electron/{cdp-routes.js,hiddenBrowser.js,webview-preload.js}` and the CDP half of `main.js` — a large chunk of the 3584 lines.
- `hiddenFetch`/`hiddenSearch` (`electron/hiddenBrowser.js`) become plain CDP page loads against the same external Chromium, killing the `/ws/electron-main` bridge (`electron/main.js:3025`) entirely.

Cost, stated honestly: a screencast canvas is not as crisp as a native webview, input latency rises, and "log into a site in a browser card" (`frontend/src/app/pages/Tools/cards/BrowserLoginConnect.tsx`, `getPartitionCookies`) needs a real visible window. Mitigation: for user-driven login, show the external Chromium window itself (non-headless, positioned over the card) rather than the screencast; cookies come from the CDP `Network.getCookies` on that browser's profile instead of an Electron partition. **BRW-6 is the ticket that proves this before anything depends on it.**

### D4 — Physical layout: **one repo, npm workspaces, new top-level `tauri/` and `engine/`. The frontend is shared, never forked.** (RECOMMENDED DEFAULT)

```
maestro-desktop/
  electron/          ← OLD shell.   Frozen except additive. Deleted in CUT.
  backend/           ← OLD server.  Frozen except additive. Deleted in CUT.
  frontend/          ← SHARED by both shells. Never forked. Gains src/shared/shell/.
  tauri/             ← NEW: src-tauri/ (Rust), tauri.conf.json, gen/{android,apple}
  engine/            ← NEW: TypeScript engine (src/, dist/, vitest)
  contract/          ← NEW: the frozen HTTP+WS seam (OpenAPI + WS schemas + shared types)
  e2e/               ← gains e2e/golden-tauri/ and e2e/contract/
  scripts/           ← gains verify-next.mjs, check-provider-egress.mjs; verify.mjs untouched
  docs/plans/        ← this doc + per-phase expansions
```

**Forking `frontend/` is the single worst thing this migration could do** — it is 365 files / 66k LOC under active development (canvas cards, i18n, workflows). A fork guarantees permanent drift and doubles every future ticket. Instead, the 16 files that touch `window.maestro` go behind a `ShellBridge` interface with two implementations (`electronShell.ts`, `tauriShell.ts`) selected at runtime. That is ticket **TAU-1** and it is the highest-leverage ticket in the plan.

Root `package.json` becomes an npm workspace over `frontend`, `engine`, `contract`, `e2e`, `electron`. `electron/package-lock.json` and `frontend/package-lock.json` stay committed (`docs/RELEASE_RUNBOOK.md` is explicit that `npm ci` requires them) — **do not** collapse them into a root lockfile during the transition; that would change the old stack's build inputs, which D5 forbids.

### D5 — Coexistence invariant (the rule every ticket is checked against)

> **Every merge to `main` must leave the OLD stack buildable, testable and releasable. `npm run verify` must be green, unchanged, at every commit.**

Operationally:
- `electron/**`, `backend/**`, `scripts/build-app-win.ps1`, `scripts/verify.mjs`, `.github/workflows/release-windows.yml` are **frozen except for additive, flag-gated changes**, until phase CUT.
- `frontend/**` is shared and therefore *not* frozen — every frontend ticket's gate includes the **old-stack golden smoke** (`npm run e2e:golden` against the packaged Electron build).
- New code is additive: new dirs, new scripts, new workflows.
- The Python backend's 6 environment-deselected tests (`scripts/verify.mjs:45`) stay exactly as they are. They are retired only when `backend/` is deleted in CUT. **The engine's own suite gets no deselect list** — it is new code, and a Windows-environment failure there is a bug to fix, not a name to add.

### D6 — 9Router's role, and what happens to it

`backend/apps/nine_router/process.py:7-11` states it plainly: 9Router is a **vendored third-party Node server (npm `9router`, pinned `0.3.60`) that proxies the user's Claude/ChatGPT/Gemini *subscriptions* into an OpenAI-compatible API on `localhost:20128/v1`**, so users can run agents without API keys. `backend/apps/agents/providers/registry.py:89-96` shows the model catalog routes `cc/...` and `cx/...` ids through it, and API-key models route through a `cp-openai` provider node into our own `openai-passthrough` (to rename `max_tokens` → `max_completion_tokens` for GPT-5).

**It is also load-bearing for authentication**, which is easy to miss: `docs/MAESTRO.md:9,33` — 9Router owns port 20128 and a patch proxies the Keycloak OAuth loopback `/callback` into the backend, because "the bundled Node process already owned this port."

**Decision:**
1. **Do not rewrite 9Router.** It is vendored third-party software. Port only its *supervision* — `process.py` (start/stop, watchdog, death-watcher, request-log rotation, Windows ACL hardening, `x-9r-cli-token` computation) — to `engine/src/router/`. Per D2a it goes in TypeScript, not Rust, because a VPS-hosted engine serving a phone still needs subscription providers.
2. **Move the OAuth loopback callback off 9Router** (ticket **ENG-5**). Owning the redirect URI through a third-party pinned dependency is fragile on Windows, unproven on macOS, and impossible on mobile. The engine gets its own loopback listener on 20128 when 9Router is absent, and continues to accept 9Router's proxied callback when present. Keycloak's registered redirect URIs (`http://127.0.0.1:20128/callback`, `http://localhost:20128/callback`, `docs/MAESTRO.md:25`) do not change, so no Keycloak-side coordination is needed.
3. **9Router does not run on mobile.** Subscription-backed providers on a phone are served by the paired engine, which does run it. This is stated in the mobile provider picker, not discovered by the user as a 404.
4. The pinned `0.3.60`-vs-`0.4.x` bump decision (`process.py:36`) is **out of scope** and stays exactly where it is. Do not let a migration ticket smuggle it in.

---

## 1. Global constraints

Every ticket inherits these; a ticket that violates one is rejected in review regardless of whether its own gate passed.

- Repo `gmartinstech/maestro-desktop`; product **"Maestro Studio"**; appId **`net.martinstech.maestro.studio`** — the Tauri `identifier` in `tauri/tauri.conf.json` **must** be this exact string, and the Store AppX package identity **must not change** (changing it orphans every Store install).
- Retain `LICENSE` (MIT © Haik Decie) and `NOTICE`. New files in `tauri/` and `engine/` are covered by the same LICENSE; do not add a second licence header scheme.
- **Zero calls to `*.openswarm.com`**, in Rust, in TypeScript, in Kotlin/Swift glue, in `Cargo.lock`, in `tauri.conf.json`.
- **All model traffic goes through the Maestro provider** `https://llm.martinstech.net/v1` (Keycloak `provedor-ia-web`, PKCE S256, `openid offline_access`) or through 9Router's local port. The internal names `provedor_ia_token` / `PROVEDOR_IA_TOKEN` / client id `provedor-ia-web` are **deliberately not renamed** (`docs/MAESTRO.md:46-56`) — the engine must read and write the same keys or every user silently loses their credential on upgrade.
- pt-BR is the **default** locale. `scripts/check-i18n-parity.mjs` is a hard gate; new UI strings in the mobile shell are locale keys from day one.
- Small diffs. One ticket per branch/worktree. **Cross-vendor review is mandatory**: `node harness/review.mjs --base main --head HEAD` → merge only on `VERDICT: APPROVE`.
- `MAESTRO_MOCK_AGENT=1` semantics are preserved verbatim in the engine: deterministic synthetic reply, no key/CLI/network, **for the packaged app and the golden smoke only**. It must remain UNSET for both the Python suite and the engine suite.

### Definition of Done (every ticket)

1. Old stack builds and launches; **`npm run verify` green** (unchanged gate).
2. New stack gate green for whatever exists at that point: **`npm run verify:next`**.
3. The ticket's own named acceptance gate passes (stated per ticket).
4. `node scripts/check-callhome.mjs` and `node scripts/check-fork-drift.mjs` clean.
5. Behaviour verified in a running app (which app, stated per ticket).
6. `node harness/review.mjs --base main --head HEAD` → `VERDICT: APPROVE`.

### Model / execution routing

- **Implement:** Haiku for single-file ports and config; Sonnet for multi-file subsystem ports and Rust; Codex where a Rust idiom is contested. One ticket per branch.
- **Review:** `harness/review.mjs` (cloud Ollama, non-Claude vendor) on every diff.
- **Opus:** phase-boundary adjudication, the D1/D3 decision points if evidence contradicts them, and authoring the per-phase expansion docs for SUB → CUT.
- **Human-only:** MAC-1 (Apple Developer enrolment, certs), MOB-6 (Play Console + App Store Connect enrolment), REL-4 (Store AppX identity transfer), and any secret provisioning.

---

## 2. Phases

```
CTR ──► TAU ──► BRW ──┐
  │       │           │
  └──► ENG ──► AGT ──► SUB ──► RMT ──┬──► MAC ──┐
                                     └──► MOB ──┴──► REL ──► CUT
```

| Phase | Name | Ends when |
|---|---|---|
| **CTR** | Contract & Parity Harness | The HTTP+WS seam is frozen, typed, and covered by a suite that can be pointed at any implementation |
| **TAU** | Tauri Desktop Shell (Windows) | A Tauri app hosts the existing frontend against the **existing Python backend** and passes a golden smoke |
| **BRW** | Browser off Electron | Browser cards and WebFetch/WebSearch run on external Chromium + CDP, in **both** shells |
| **ENG** | TS Engine skeleton + infra | Engine boots, owns auth/health/settings/router, proxies everything else to Python |
| **AGT** | Agent loop port | Agent turns run natively in TS; Python's `apps/agents` is dark |
| **SUB** | Remaining subsystems | Every `/api/*` prefix is served natively; Python serves nothing |
| **RMT** | Remote engine mode | The client works against a non-localhost engine, with pairing and transport auth |
| **MAC** | macOS desktop target | Signed, notarised macOS build with a working updater |
| **MOB** | Android + iOS clients | Both mobile shells drive a paired engine end to end |
| **REL** | Release engineering | Four platforms build in CI; Store/CDN dual-channel reconciled across stacks |
| **CUT** | Cutover & retirement | Tauri+TS is the shipped default; `electron/` and `backend/` are deleted |

---

## Phase CTR — Contract & Parity Harness

**Why first:** everything else is a swap behind this seam. CTR is 100% additive to the old stack, carries near-zero risk, and produces the oracle that makes every later phase falsifiable. It also fixes a real current weakness: the golden smoke (`e2e/golden/golden-path.spec.ts`) asserts *boot health only* — it explicitly does not drive an agent turn (see its header comment). A migration cannot be validated by a boot check.

### CTR-1 — Freeze the HTTP contract as a generated OpenAPI artifact
**Files:** create `contract/openapi.json`, `contract/package.json`, `scripts/gen-contract.mjs`
**Do:** FastAPI already serves `/openapi.json` (`backend/config/Apps.py` builds the `FastAPI` app; `MainApp` mounts 15 SubApps under `/api/<name>`). Boot the Python backend with `MAESTRO_MOCK_AGENT=1`, snapshot `/openapi.json` to `contract/openapi.json`, commit it.
**Gate:** `node scripts/gen-contract.mjs --check` re-derives the snapshot and exits 0 (byte-identical modulo key order). Wire it into `verify:next`. Any backend route change now shows up as a contract diff in review — which is exactly the signal you want during a rewrite.
**Anchor counts for sizing:** workflows 35 routes · agents 34 · outputs 27 · tools_lib 18 · settings 14 · dashboards 9 · skills 8 · skill_registry 7 · service 6 · modes 6 · swarm 4 · mcp_registry 3 · web 2 · dashboard_layout 2 · health 1 = **176 HTTP routes**, plus 3 WebSockets.

### CTR-2 — Freeze the WebSocket contract by hand
**Files:** create `contract/ws/{agents.ts,runtime-logs.ts,electron-main.ts}`, `contract/ws/README.md`
**Do:** OpenAPI does not cover WS. Enumerate every event on `/ws/agents/{session_id}` (`backend/main.py:155`), `/ws/outputs/runtime/{workspace_id}/logs` (`backend/main.py:258`) and `/ws/electron-main` (`electron/main.js:3028`). Source of truth for the emitting side: `backend/apps/agents/core/ws_manager.py` (341 lines) — `send_to_session`, `send_browser_command`, `send_approval_request`. Source of truth for the consuming side: `frontend/src/shared/ws/WebSocketManager.ts` (its import block at lines 1-40 is an exhaustive index of which Redux action each event drives). Write discriminated-union TS types, one per event.
**Gate:** `frontend/src/shared/ws/WebSocketManager.ts` compiles against the imported `contract/ws` types with no `any` on the message parameter. `npm run verify` green (frontend typecheck is in it).

### CTR-3 — Contract test suite, implementation-agnostic
**Files:** create `e2e/contract/{run.ts,http.spec.ts,ws.spec.ts}`; add `"test:contract"` to root `package.json`
**Do:** a suite that takes `MAESTRO_API_BASE` + a token and exercises the contract: every GET route answers, auth rejection works (missing token → 401; see `backend/main.py:97` `p_auth_middleware` and its exemptions), CORS/preflight behaves, the WS handshake rejects a bad token with close code **4401** (`backend/main.py:253`), and the `replay_to`/`last_seq` resume path works (`backend/main.py:187`).
**Gate:** green against the Python backend. This is the artifact ENG/AGT/SUB are graded against.

### CTR-4 — Headless golden **turn** (not just boot), against Python
**Files:** create `e2e/contract/golden-turn.spec.ts`
**Do:** boot the backend directly (no shell) with `MAESTRO_MOCK_AGENT=1` and an isolated `MAESTRO_DATA_ROOT`/`MAESTRO_STATE_HOME` (copy the isolation approach from `e2e/golden/fixtures.ts:36-40` and its opaque-token seeding at `:14-18`). Create a session over HTTP, open the WS, send a message, assert the full deterministic `MockAgent` reply arrives as `agent:message` + a terminating status.
**Gate:** green against Python. **This spec is the single most important artifact in the plan** — it is the same file, unchanged, that gates AGT-6.
**Risk it retires:** the current smoke would happily stay green through a total agent-loop regression.

### CTR-5 — Split `verify` without touching `verify`
**Files:** create `scripts/verify-next.mjs`; add `verify:next` and `verify:all` to root `package.json`. **Do not edit `scripts/verify.mjs`.**
**Do:** `verify:next` starts as: `test:contract` + `gen-contract --check` + `check-callhome` + `check-fork-drift` + `check-i18n-parity`. It grows a step per phase (stated in each phase). `verify:all` runs `verify` then `verify:next`.
**Gate:** `npm run verify` byte-identical behaviour (diff `scripts/verify.mjs` = empty); `npm run verify:all` green.

### CTR-6 — Extend the guards for the trees that do not exist yet
**Files:** `scripts/check-callhome.mjs:13,17`; `scripts/check-fork-drift.mjs` `ALLOW_PREFIX`
**Do:** in `check-callhome.mjs`, extend `ROOTS` to `['frontend/build','electron','engine/src','engine/dist','tauri/src','tauri/gen','contract']` and the extension regex from `/\.(js|html|json|css)$/` to also match `rs|toml|ts|tsx|mjs|kt|swift|plist|xml|yml`. Keep the `FORBIDDEN` literals **exactly as they are** — the file's own header calls itself a guard file and warns against renaming them. In `check-fork-drift.mjs`, add `tauri/gen/` to `ALLOW_PREFIX` (generated Android/iOS projects contain vendor boilerplate) but **not** `engine/` or `tauri/src/` — new hand-written code must be fully guarded.
**Gate:** both scripts clean; `npm run verify` still green.

### CTR-7 — npm workspace root, non-destructively
**Files:** root `package.json`
**Do:** add `"workspaces": ["frontend","engine","contract","e2e","electron"]`. Verify `cd frontend && npm ci` and `cd electron && npm ci` still resolve exactly as before (the build scripts call them with `--prefix`, and hoisting must not change what `electron-builder` packages).
**Gate:** a full `pwsh scripts\build-app-win.ps1` produces a working packaged app; `npm run e2e:golden` passes against it. **If hoisting perturbs the Electron package contents at all, revert this ticket and keep the trees independent** — workspace ergonomics are not worth risking the shipped build.

**CTR risks / rollback**

| Risk | Mitigation | Rollback |
|---|---|---|
| Workspace hoisting changes what electron-builder packages | CTR-7 gate is a full packaged build + golden smoke | Revert CTR-7; run `engine/` and `tauri/` as independent npm roots (costs ergonomics, nothing else) |
| The WS contract has undocumented events | CTR-2 cross-checks emitter (`ws_manager.py`) against consumer (`WebSocketManager.ts`) — two independent enumerations | n/a, additive |
| CTR-4 exposes that MockAgent output is not actually deterministic | Fix `backend/apps/agents/manager/MockAgent.py` before proceeding; a non-deterministic mock invalidates every later parity claim | Blocks the phase deliberately |

**Rollback for the whole phase:** every file is new except three additive edits. `git revert` the phase branch; nothing shipped depends on it.

---

## Phase TAU — Tauri Desktop Shell (Windows), against the **existing Python backend**

**Why here:** de-risk the shell swap in isolation, while the server is a known-good constant. If Tauri cannot host this frontend, we find out in weeks, not after a backend rewrite.

### TAU-1 — `ShellBridge` abstraction in the shared frontend ⚠️ highest-leverage, highest-risk ticket
**Files:** create `frontend/src/shared/shell/{ShellBridge.ts,electronShell.ts,tauriShell.ts,index.ts}`; modify the 16 files that reference `window.maestro` (enumerate with `grep -rln "window\.maestro\|(window as any)\.maestro" frontend/src`); source of truth for the surface is `electron/preload.js` (170 lines, ~40 members).
**Do:** define `ShellBridge` as the union of what `preload.js` exposes: `getBackendPort`, `getBackendPortLive`, `getAuthToken`, `getAppVersion`, `getBuildInfo`, `platform`, `popupAppMenu`, `setTitleBarOverlay`, `openExternal`, `hardReset`, `clearBrowserData`, `capturePage`, the updater group (`getUpdateStatus`/`checkForUpdates`/`downloadUpdate`/`installUpdate`/`setAllowPrerelease`/`openStoreUpdates` + their `on*` subscriptions), the CDP group, the browser/webview group, `onOauthClaim`/`onOauthCallback`, `restartApp`/`openBackendLogs`/`onBackendUnrecoverable`. `index.ts` selects `electronShell` when `window.maestro` exists, `tauriShell` when `window.__TAURI_INTERNALS__` exists, and a `nullShell` (every method a typed no-op with a logged warning) otherwise — the null case is what makes RMT's browser-hosted client possible later. **This ticket only introduces the indirection; `electronShell.ts` is a pure passthrough and behaviour must not change by one line.**
**Gate:** `grep -rn "window\.maestro" frontend/src` returns matches **only** in `frontend/src/shared/shell/electronShell.ts`. `npm run verify` green **including the packaged-Electron golden smoke** — this is the proof of no behavioural change.

### TAU-2 — Scaffold the Tauri app (Windows only)
**Files:** create `tauri/{Cargo.toml,tauri.conf.json,build.rs,src/main.rs,src/lib.rs}`, `tauri/icons/*`
**Do:** `identifier: "net.martinstech.maestro.studio"`, `productName: "Maestro Studio"`. Load `frontend/build/index.html` from the bundle. Icons regenerate from `assets/brand/maestro/` — extend `scripts/gen-icons.py` (backend-venv Pillow, no new deps; already emits nine surfaces) with the Tauri icon set rather than adding a second generator.
**Gate:** `cargo tauri dev` shows the real React UI with the backend port injected manually; window title is "Maestro Studio".

### TAU-3 — Python backend as a Tauri sidecar, with the restart policy
**Files:** create `tauri/src/sidecar.rs`, `tauri/src/restart_policy.rs`
**Do:** port `electron/main.js:911 startBackend()`, `:824 waitForBackend()`, `:888 pickBackendPort()`, `:1812 maybeRestartBackend()`, `:1853 killBackend()` and `electron/backendRestartPolicy.js` to Rust. Spawn the **same** `python-env` payload with the **same** env contract (`MAESTRO_PORT`, `MAESTRO_PACKAGED`, `MAESTRO_DATA_ROOT`, `MAESTRO_STATE_HOME`, `MAESTRO_NODE_PATH`, `MAESTRO_TIMEZONE`, `MAESTRO_INSTALLATION_ID`).
**Gate:** `electron/backendRestartPolicy.test.js`'s cases are ported to Rust `#[test]`s and pass with identical decisions for identical inputs. Kill the Python process manually → the Tauri app restarts it, then gives up after the same bounded count and surfaces the same `backend-unrecoverable` event.

### TAU-4 — Auth token + port bridge (`tauriShell.ts` ⟷ Rust commands)
**Files:** `tauri/src/commands.rs`, `frontend/src/shared/shell/tauriShell.ts`
**Do:** implement `get_backend_port`, `get_auth_token`, `get_app_version`, `get_build_info`, `open_external`, `hard_reset` as `#[tauri::command]`s. The token is read from the same file the Electron shell reads (`electron/backendPaths.js` `authTokenPath` → port that path resolution to Rust; the backend writes it pre-bind, `backend/main.py:53-58`). **The token must not be exposed as a window global** — same reasoning as `electron/preload.js:38-44`; it crosses only via the command bridge.
**Gate:** the Tauri app boots, `frontend/src/shared/config.ts`'s fetch interceptor attaches a valid bearer, `GET /api/health/check` returns 200 from inside the webview, and the WS connects without a 4401.

### TAU-5 — Splash, titlebar overlay, menu, deep links, single instance
**Files:** `tauri/src/{splash.rs,menu.rs,deeplink.rs}`, `tauri/tauri.conf.json`
**Do:** port `electron/main.js:588 createSplashWindow()` + `:650 emitSplashStatus()` + the `splash:action` handler (`:2859`), the unified titlebar (`decorations: false` + a Rust equivalent of `titleBarOverlay`), the app menu (`:1193 buildAppMenu()`), `maestro://` deep links via `tauri-plugin-deep-link`, and single-instance via `tauri-plugin-single-instance`. **Carry forward the warning at `docs/HANDOFF.md:102`:** do not simplify the menu away — `AppShell.tsx` depends on the *View → Reload* accelerator existing.
**Gate:** splash appears within 300ms of launch and closes when the main window is ready; `maestro://oauth/test/complete` from a browser reaches `onOauthClaim` in the renderer; a second launch focuses the existing window.

### TAU-6 — Golden smoke for the Tauri shell
**Files:** create `e2e/golden-tauri/{fixtures.ts,golden-path.spec.ts}`
**Do:** launch the Tauri binary with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and attach with Playwright's `chromium.connectOverCDP`. This keeps the assertions of `e2e/golden/golden-path.spec.ts` nearly verbatim — `toHaveTitle(/Maestro Studio/)`, `getByTestId('global-search-trigger')`, the `/api/health/check` in-page fetch. Reuse the isolation + opaque-token seeding from `e2e/golden/fixtures.ts` unchanged.
**Fallback, decide inside this ticket:** if CDP will not attach to WebView2, switch to `tauri-driver` + WebdriverIO and port the three assertions. Record which path was taken in the PR — MAC-5 and MOB-5 depend on the answer.
**Gate:** `npm run e2e:golden:tauri` passes. Add it to `verify:next`.

### TAU-7 — Unsigned Windows Tauri artifact in CI
**Files:** create `.github/workflows/build-tauri-windows.yml`
**Do:** build `tauri/` on `windows-latest`, upload an NSIS installer as a workflow artifact. **Publishes nothing.** Do not touch `release-windows.yml`.
**Gate:** artifact downloads and installs on a clean VM; app launches; golden-tauri passes against the installed build. Record the installed footprint against the Electron build's (the lightweight claim needs a number, not a vibe).

**TAU risks / rollback**

| Risk | Mitigation | Rollback |
|---|---|---|
| TAU-1 breaks a `window.maestro` consumer in a way types do not catch | Passthrough-only implementation; gate is the old-stack packaged golden smoke, not a typecheck | Revert TAU-1; it is a self-contained refactor |
| WebView2 renders the MUI/xterm/CodeMirror/framer-motion frontend differently than Chromium | Discovered in TAU-2, weeks in, cheaply | If severe, the phase stops here and the whole migration is re-scoped before any backend work — this is why TAU precedes ENG |
| Tauri cannot reproduce the splash/titlebar/menu UX | TAU-5 is a standalone ticket with a visual gate | Ship the Tauri shell with OS decorations initially; cosmetic, not blocking |
| No CDP on WebView2 → no Playwright | TAU-6 has a named fallback (tauri-driver/WDIO) | Fallback path, decided in-ticket |

**Rollback for the phase:** delete `tauri/`, revert TAU-1. The Electron stack never depended on any of it.

---

## Phase BRW — Browser subsystem off Electron

Implements **D3**. Lands in **both** shells simultaneously (the frontend is shared), so the Electron build gets the new browser engine too — which is what makes the gate honest.

| # | Ticket | Files | Acceptance gate |
|---|---|---|---|
| BRW-1 | External Chromium launcher + binary resolution | new `engine/src/browser/launcher.ts` (standalone module, runnable before the engine exists) | Resolves system Edge on Windows and Chrome on macOS; downloads Chromium only when neither is present; unit-tested with a stubbed filesystem |
| BRW-2 | CDP client + the command set | new `engine/src/browser/cdp.ts` | Implements every `BrowserAction` in `frontend/src/shared/browserCommandHandler.ts:15` (all 20: screenshot, get_text, get_console, navigate, click, type, evaluate, get_elements, scroll, wait, press_key, list_interactives, click_index, click_point, batch, detect_webmcp, list_routes, replay_route, click_by_name) with identical result shapes |
| BRW-3 | Screencast transport | `engine/src/browser/screencast.ts`; new WS event in `contract/ws/agents.ts` | `Page.startScreencast` frames reach the renderer at ≥10fps at 1280×900; backpressure drops frames instead of queueing |
| BRW-4 | Canvas browser card | `frontend/src/app/pages/Dashboard/cards/browser/BrowserCard.tsx`, `frontend/src/shared/browserRegistry.ts`, `browserCommandHandler.ts` | Card renders screencast; mouse/keyboard input round-trips; `useWebviewSuspend.ts` suspend/resume still works; thumbnail capture no longer needs the `BUSY_COOLDOWN_MS` webview-churn workaround (`browserCommandHandler.ts:28`) |
| BRW-5 | Replace `hiddenFetch`/`hiddenSearch`; retire `/ws/electron-main` | `engine/src/browser/fetch.ts`; `backend/apps/web/web.py` gains an engine-backed tier alongside the bridge tier | `backend/tests/` web-tier tests pass with the bridge disabled; the `/ws/electron-main` consumer at `electron/main.js:3025` becomes dead code (deleted in CUT) |
| BRW-6 | **Interactive login / cookie capture** ⚠️ the risky one | `frontend/src/app/pages/Tools/cards/BrowserLoginConnect.tsx`; `engine/src/browser/cookies.ts` | A user completes a real login in the visible external Chromium and the session cookies reach the MCP shim that needs them, replacing `readPartitionCookies` (`electron/main.js:2974`). **If this cannot be made to work, escalate to Opus before BRW-7 — it may force keeping an Electron-hosted browser on Windows as a transitional tier** |
| BRW-7 | Both-shell parity gate | — | Browser-agent e2e passes under **both** the packaged Electron build and the Tauri build; `backend/tests/test_browser_*.py` (≈20 files) unchanged and green |

**Risk:** BRW is the phase most likely to slip, because it trades a native embedded webview for a streamed one and the UX delta is real. **Rollback:** every BRW change is additive behind a `MAESTRO_BROWSER_ENGINE=electron|cdp` switch defaulting to `electron` until BRW-7; flipping the env var restores the old path instantly. The switch is deleted in CUT.

---

## Phase ENG — TypeScript engine skeleton + infrastructure subsystems

The strangler mechanism starts here.

### ENG-1 — Engine skeleton and the **route splitter**
**Files:** create `engine/{package.json,tsconfig.json,vitest.config.ts,src/main.ts,src/server.ts,src/split.ts}`
**Do:** a Fastify (or Hono-on-node) server that binds the port the shell tells it to, and for each `/api/<name>` prefix either serves natively or **transparently proxies to a Python backend it spawns as a child on an internal port** — including WebSocket frame proxying for `/ws/*`. Ownership is a per-prefix table driven by `MAESTRO_ENGINE_ROUTES` (default: everything proxied).

> **This is the strangler fig.** After ENG-1 the engine is the only thing the frontend and the shell talk to, and each later ticket flips exactly one `/api/<name>` prefix from `proxy` to `native`. Rollback for any subsystem port is a single env-var entry, at runtime, with no rebuild.

**Gate:** with everything proxied, `npm run test:contract` and `e2e/contract/golden-turn.spec.ts` are green **through the engine**, byte-identical responses. The Electron shell, pointed at the engine instead of Python, passes `npm run e2e:golden`.

### ENG-2 — Auth middleware + token lifecycle (native)
**Files:** `engine/src/auth/{token.ts,middleware.ts,scrubber.ts}` — port `backend/auth.py` and `backend/main.py:97-155`
**Do:** per-install token generated **before the port binds** (the ordering comment at `backend/main.py:53` is a real constraint, not decoration). Exempt paths, `Authorization: Bearer` / `x-maestro-token` / `x-api-key` (the Claude Code CLI path) / `?token=` (the App Builder iframe path). WS auth returning close code **4401**. The log scrubber, installed after the token exists.
**Gate:** the auth section of `e2e/contract/http.spec.ts` passes natively; `backend/tests/` auth tests have TS twins in `engine/` with the same names.

### ENG-3 — Settings store, with the shared-file ownership rule
**Files:** `engine/src/settings/{store.ts,models.ts,migrations.ts}` — port `backend/apps/settings/{store.py,models.py}`, `backend/config/{json_store.py,paths.py,state_paths.py}`
**⚠️ Hard constraint:** during the transition two processes coexist over one on-disk store. **Exactly one process owns each store file.** Rule: **the engine owns `settings`; Python reads settings but never writes them.** Implement by making the Python side's `save_settings` raise when `MAESTRO_ENGINE_OWNS_SETTINGS=1` (an additive, flag-gated Python change — permitted under D5), and by routing all settings writes through `/api/settings` on the engine.
**Also port verbatim:** the atomic write with directory fsync (there is a test named for it — `test_disk_resilience.py::test_atomic_write_fsyncs_directory_after_rename`, one of the six deselected on Windows; **the engine's version must pass on Windows, no deselect**), the legacy-key migration table (`store.py` is on `check-fork-drift.mjs`'s `ALLOW` list precisely because it must keep the old `openswarm` key names), and `provedor_ia_token` unrenamed.
**Gate:** an existing user profile (real `settings.json` with a stored credential) is read identically by both implementations, byte-compared. Round-trip through the engine leaves the file semantically unchanged.

### ENG-4 — Credential store (Keycloak refresh token)
**Files:** `engine/src/settings/credentialStore.ts` — port `backend/apps/settings/maestro_credential_store.py`
**Decision to make in-ticket:** Python `keyring` → `@napi-rs/keyring` (prebuilt, no node-gyp) as the default, with an **encrypted-file fallback** for headless/VPS engines with no OS keyring (required by D1). Do **not** use `keytar` (unmaintained).
**⚠️ Migration:** the token was written by Python `keyring` under a specific service/account name. The TS reader must read that exact entry or every user is silently logged out. Read the names out of `maestro_credential_store.py` and pin them in a test.
**Gate:** a refresh token stored by the Python implementation is read by the TS implementation on the same Windows machine, and vice versa.

### ENG-5 — Maestro Keycloak OAuth (native) + move the loopback off 9Router
**Files:** `engine/src/settings/{keycloakAuth.ts,tokenStatus.ts,loopback.ts}` — port `maestro_keycloak_auth.py`, `maestro_token_status.py`, `maestro_scheduler.py`
**Do:** authorization-code + PKCE S256, `scope=openid offline_access`, issuer `https://martinstech.net/auth/realms/MartinsTech`, client `provedor-ia-web` (public, **no secret exists** — `docs/MAESTRO.md:24`), redirect `http://127.0.0.1:20128/callback`. Per D6, the engine owns a loopback listener on 20128 when 9Router is not up, and still accepts 9Router's proxied callback when it is. Preserve the `opaque` (`mtok_…`) token classification (`maestro_token_status.py`) — `e2e/golden/fixtures.ts:14` depends on it.
**Gate:** `backend/tests/test_maestro_keycloak_auth.py`, `test_maestro_token_status*.py` (5 files) have passing TS twins; a real end-to-end login against the live Keycloak succeeds and the refresh survives an engine restart.

### ENG-6 — 9Router supervision (native)
**Files:** `engine/src/router/{process.ts,sync.ts,oauth.ts,health.ts}` — port `backend/apps/nine_router/*` (1895 LOC)
**Do:** a faithful port. Every comment in `process.py` is a scar: the 127.0.0.1-before-localhost fast-fail probe (`:94-108`), the positive/negative `is_running` TTL caches (`:67,71`), request-log rotation to dodge the OOM (`:45`), `--max-old-space-size=4096`, the Windows ACL hardening with its verify-and-roll-back-on-empty-DACL logic (`:197-225`), the `x-9r-cli-token` derivation (`:289`), the watchdog's two-strike confirmation (`:552`), the death-watcher's 3-deaths-in-60s guard (`:590`). **Do not "clean up" any of it.** Keep the `0.3.60` pin (D6).
**Gate:** `test_router_data_dir_permissions.py`, `test_router_sync_guards.py`, `test_router_watchdog.py`, `test_process.py` all have passing TS twins. `e2e/helpers/processTree.ts` reaps the router on teardown (see commit `06014949`).

### ENG-7 — Health, service, provider egress chokepoint
**Files:** `engine/src/apps/{health,service}/*`; **create `engine/src/net/http.ts`**; create `scripts/check-provider-egress.mjs`; `engine/eslint.config.mjs`
**Do:** flip `/api/health` and `/api/service` to native. Then the compliance ticket: **all outbound HTTP in the engine goes through `engine/src/net/http.ts`**, which enforces a host allowlist (`llm.martinstech.net`, `martinstech.net`, `cdn.martinstech.net`, `127.0.0.1`/`localhost`, `api.anthropic.com`/`api.openai.com` only for the explicitly-configured own-key passthrough lanes, `github.com`/`registry.npmjs.org` for build-time-only paths). Enforce with an ESLint `no-restricted-imports` rule banning `node:http`, `node:https`, `undici`, `axios`, `got` and bare `fetch` **outside** `engine/src/net/`.
**Gate:** `node scripts/check-provider-egress.mjs` exits 0; `cd engine && npm run lint` fails on a deliberately-added rogue `fetch` in a test fixture. This is what re-verifies the never-call-openswarm and Maestro-provider-only constraints against a rewrite — **string scanning alone is not sufficient for new code**, so it is a lint rule plus `check-callhome`, not either alone.

**ENG gate additions to `verify:next`:** `cd engine && npm run lint && npx tsc --noEmit && npm test`, plus `check-provider-egress`.

**ENG risks / rollback**

| Risk | Mitigation | Rollback |
|---|---|---|
| Two processes corrupt a shared JSON store | ENG-3's single-owner rule, flag-enforced on the Python side | `MAESTRO_ENGINE_ROUTES` back to all-proxy + unset the ownership flag |
| Credential-store migration loses users' tokens | ENG-4's bidirectional read test on a real Windows profile | Engine falls back to reading via a Python one-shot until fixed |
| The proxy hop adds user-visible latency | Measure in ENG-1; it is loopback and short-lived (removed at CUT) | Accept; it is transitional |
| Moving the OAuth loopback breaks login for users mid-transition | ENG-5 keeps *both* paths live simultaneously | Disable the engine listener; 9Router keeps the callback |

---

## Phase AGT — Agent loop port

The heart. ~22k LOC in `backend/apps/agents/`, of which ~5.5k is the browser subsystem already handled by BRW.

### AGT-1 — Provider registry + env adapter
**Files:** `engine/src/agents/providers/{registry.ts,pricing.ts}`, `engine/src/agents/manager/configureProviderEnv.ts` — port `registry.py` (409 LOC), `pricing.py` (319), `configure_provider_env.py`
**⚠️** The registry's comments encode live routing decisions (`registry.py:89` on why `cx/gpt-5.5` is pulled at the 0.3.60 pin; `:96` on the `cp-openai` node and the `max_tokens`→`max_completion_tokens` passthrough). Port the comments with the code.
**Gate:** `backend/apps/agents/providers/tests/` have passing TS twins; for every model id in the catalog, the TS and Python adapters produce **identical env dicts** (write this as a table-driven differential test).

### AGT-2 — WS manager + session models
**Files:** `engine/src/agents/core/{wsManager.ts,models.ts}` — port `ws_manager.py` (341 LOC), `core/models.py`
**Gate:** the `contract/ws` types (CTR-2) are the *implementation* types, not a parallel definition. `replay_to`/`last_seq` resume works identically.

### AGT-3 — `MockAgent` seam
**Files:** `engine/src/agents/MockAgent.ts` — port `MockAgent.py`; seam at `agent_manager.py` (per `docs/HANDOFF.md:86`, mock selection sits *ahead of* provider resolution)
**Gate:** for the same input, TS and Python `MockAgent` emit **byte-identical** WS event sequences. Do it first: it makes AGT-6 a true differential test rather than a vibe check.

### AGT-4 — Turn runner on `@anthropic-ai/claude-agent-sdk`
**Files:** `engine/src/agents/manager/run/turnRunner.ts` + `engine/src/agents/manager/streaming/*` — port `TurnRunner.py` (203), `streaming/{handle_stream_event,handle_assistant_message,handle_result_message,state,thinking,stop_hook}.py`, `run/{RunOptions,client_pool}.py`, `RunSupport.py`
**Do:** swap `claude_agent_sdk` (Python) for `@anthropic-ai/claude-agent-sdk` (TS). **Pin the TS SDK to the version bundling the same Claude Code CLI as `claude-agent-sdk==0.1.70` (CLI 2.1.122, floor 2.1.90 for the deferred-tools cache fix — `backend/requirements.txt:8-9`).** A different bundled CLI is a behaviour change disguised as a dependency bump; add the pin to `docs/RELEASE_RUNBOOK.md`'s pin table in the same PR.
**Gate:** capacity-retry backoffs (`error_classify.py` `CAPACITY_BACKOFFS`), thinking-token aggregation, and the persisted "Thought for Ns · M tokens" label match Python's for recorded fixtures.

### AGT-5 — Permission gates, prompt composition, session lifecycle
**Files:** port `manager/permissions/gate_hooks.py`, `manager/prompt/{prompt_context.py,attachments.py}`, `manager/session/{SessionLifecycle.py,history_compaction.py}`, `manager/{AgentLaunch,Messaging,metadata}.py`
**Gate:** TS twins pass for `test_gate_hooks.py`, `test_path_gate.py`, `test_system_prompt.py`, `test_context_budget.py`, `test_context_pressure_valve.py`, `test_distill_history.py`, `test_compact_endpoint.py`.

### AGT-6 — Flip `/api/agents` + `/ws/agents` to native ⚑ THE MILESTONE
**Files:** `engine/src/split.ts` route table
**Gate:** **`e2e/contract/golden-turn.spec.ts` — the identical file written in CTR-4 against Python — passes against the engine, unmodified.** Plus: all 34 `/api/agents` routes contract-clean; `npm run e2e:golden` and `npm run e2e:golden:tauri` green; a real (non-mock) turn against the Maestro provider completes in both shells.
**Rollback:** one entry in `MAESTRO_ENGINE_ROUTES` back to `proxy`. No rebuild, no release.

### AGT-7 — Anthropic proxy + OpenAI passthrough
**Files:** port `proxy/anthropic_proxy.py` (497), `proxy/anthropic_to_openai.py` (385), `core/openai_passthrough.py`
**⚠️** The Claude Code CLI we spawn is configured with `ANTHROPIC_API_KEY=<our per-install token>` so its `x-api-key` header carries our token (`backend/main.py:105-110`). The engine's auth middleware must keep accepting that, and the proxy route must stay non-exempt.
**Gate:** a CLI-driven turn routes through the engine's proxy; the `max_tokens`→`max_completion_tokens` rename fires for GPT-5 models.

---

## Phase SUB — Remaining subsystems

One ticket per SubApp; each flips one `/api/<name>` prefix. Ordered by risk-adjusted value. **Gate for every ticket:** the SubApp's routes are contract-clean, its Python tests have passing TS twins, `verify:all` green, both golden smokes green, and the prefix flipped to `native` in `split.ts`.

| # | SubApp | Python LOC | Notes |
|---|---|---|---|
| SUB-1 | `modes`, `dashboard_layout`, `health` | ~420 | Warm-up. Smallest surface, 9 routes total. |
| SUB-2 | `skills` + `skill_registry` | ~1,330 | Watch `test_skills_folders.py::test_swarm_export_folder_skill_carries_supporting_files` — a deselected-on-Windows test; the TS twin **must** pass on Windows. |
| SUB-3 | `dashboards` + `swarm` | ~2,480 | Includes `swarm/redact.py` — credential redaction; `provedor_ia_token` must stay redacted (`docs/MAESTRO.md:58-64`). |
| SUB-4 | `mcp_registry` + `tools_lib` | ~2,050 | Spawns the vendored Node MCP bundles (`backend/mcp-bundles/**`). **Also close the orphan flagged at `docs/HANDOFF.md:147-154`: `@kirbah/mcp-youtube` has no builder since `build-app.sh` was deleted.** Either add the esbuild step to the engine's build or drop the bundle deliberately — do not carry an unbuildable binary into the new stack. |
| SUB-5 | `outputs` (+ `output_versions`) | 4,167 | The App Builder: spawns `npm install`, Vite, uvicorn; `runtime_proc.py` does signal-based suspend/resume and descendant-tree kills. Rewriting POSIX signal semantics in Node needs care on Windows. Includes `webapp_template/` (on `check-fork-drift`'s ALLOW list — keep it there). |
| SUB-6 | `terminal` | 480 | PTY. `pywinpty` → `@lydell/node-pty` or `node-pty` with prebuilds; **no node-gyp at install time.** Per D2a this is TS, not Rust, because a remote client needs terminals from a headless engine. |
| SUB-7 | `workflows` | 3,347 | Largest route count (35). Coordinate with `electron/workflowsLifecycle.js` — port it into the Rust core. |
| SUB-8 | `web` | 643 | Depends on BRW-5 (the CDP fetch tier). Retires `/ws/electron-main`. |
| SUB-9 | social/MCP shims: `discord`, `google_workspace`, `reddit`, `tiktok`, `x`, `social_shims` | ~2,820 | Session-cookie-backed; depends on BRW-6. Reconfirm the DET-6 decision (`docs/plans/2026-07-20-det-detach.md` Task 6): cloud-brokered connectors stay **disabled**; `OPENSWARM_OAUTH_BASE_URL` stays unset. Do not let a port re-add a default. |
| SUB-10 | Python is dark | — | `MAESTRO_ENGINE_ROUTES` has zero `proxy` entries. The engine no longer spawns Python. **`npm run verify` must still be green** — the Python suite still runs, the backend just is not in the request path. |

---

## Phase RMT — Remote engine mode (the mobile enabler)

Entirely desktop-testable. Implements D1's mechanism.

| # | Ticket | Files | Acceptance gate |
|---|---|---|---|
| RMT-1 | Engine runs standalone headless | `engine/src/main.ts` | `node engine/dist/main.js --headless --port 8324` on a Linux VPS with no Tauri, no GUI, no keyring; `test:contract` green against it over the network |
| RMT-2 | Client base-URL is configuration, not a constant | `frontend/src/shared/config.ts:12-14`, `frontend/src/shared/ws/WebSocketManager.ts` | `API_BASE`/`WS_BASE` come from a resolved connection profile (local sidecar \| paired remote), not from `window.location.hostname` + a port. `nullShell` (TAU-1) path works: the frontend runs in a plain browser against a remote engine |
| RMT-3 | Pairing + transport auth | `engine/src/auth/pairing.ts`, `frontend/src/app/pages/Settings/sections/connection/*` | Pair by QR/code; the per-install bearer never crosses the network in the clear — TLS with a pinned self-signed cert, or the caller is required to be on a private overlay network. **Explicitly document that plain-HTTP-over-LAN is not offered** |
| RMT-4 | Connection state in the UI | `frontend/src/shared/state/*` | Disconnect/reconnect/degraded states are first-class; `WebSocketManager`'s existing `setSessionConnState` reused; offline shows the read-only cache, never a spinner |
| RMT-5 | Engine egress hardening | `engine/src/net/http.ts`, `engine/src/server.ts` | A non-loopback-bound engine still refuses unauthenticated requests, rate-limits pairing attempts, and `check-provider-egress` stays clean |

**Risk:** RMT-3 turns a localhost-only app into a network service — the largest security-surface change in the plan. **Mitigation:** default binding stays `127.0.0.1`; remote listening is opt-in per install; this phase gets a dedicated `/security-review` pass before merge, not just `harness/review.mjs`.

---

## Phase MAC — macOS desktop target (new work; see D0)

| # | Ticket | Acceptance gate |
|---|---|---|
| MAC-1 (HUMAN) | Apple Developer enrolment, Developer ID Application cert, app-specific password / App Store Connect API key; record in `docs/SECRETS.md` | Certs present in CI secrets; no key ever committed |
| MAC-2 | `tauri.conf.json` macOS bundle: `.app` + `.dmg`, minimum system version, entitlements | `cargo tauri build --target universal-apple-darwin` produces a launching `.app` |
| MAC-3 | Signing + **notarisation via Tauri's bundler** (not a ported `notarize.js` — that file was Electron-specific and is gone) | `spctl -a -vvv Maestro\ Studio.app` → "accepted, source=Notarized Developer ID"; Gatekeeper-clean on a fresh Mac |
| MAC-4 | Sidecar + `python-env`-free packaging on macOS; Node payload for macOS arm64/x64 | Engine sidecar starts; a real agent turn completes on macOS |
| MAC-5 | macOS golden smoke via `tauri-driver`/WDIO (WKWebView has no CDP — see TAU-6) | The three golden assertions pass on macOS |
| MAC-6 | `tauri-plugin-updater` on macOS + the CDN manifest | An older build updates to a newer one from `cdn.martinstech.net` |
| MAC-7 | Doc reconciliation: `docs/HANDOFF.md` §10 gains a dated reversal note pointing at this plan; `docs/UPSTREAM.md` clarifies that upstream mac commits remain out of scope (upstream is still Electron) | Neither doc contradicts the other; `check-fork-drift` clean (the Apple keychain access-group string stays forbidden) |

**Note on what is explicitly *not* revived:** `mouseclamp` (an Electron cursor-crash workaround — do not port it; verify the crash does not reproduce under WKWebView and record that in MAC-2's PR), VMP/Widevine signing (no castlabs fork in Tauri; DRM playback was already disabled per DET-9), and `build-python-env.sh` (there is no Python to build).

---

## Phase MOB — Android + iOS thin clients

| # | Ticket | Acceptance gate |
|---|---|---|
| MOB-1 | `cargo tauri android init` / `ios init`; commit `tauri/gen/{android,apple}` | Both projects build a debug artifact locally |
| MOB-2 | Mobile `ShellBridge` implementation | `mobileShell.ts` implements the bridge; every desktop-only member (CDP group, `capturePage`, updater group) is a typed no-op that logs, never throws |
| MOB-3 | **Mobile route subset** — do *not* ship the desktop dashboard canvas | A phone-sized route set: session list, transcript, composer, approval gates, outputs viewer, connection settings. The draggable-card canvas (`DashboardCardLayer.tsx`) is explicitly **excluded** on mobile. New strings are locale keys in both `pt-BR` and `en` (`check-i18n-parity` is a hard gate) |
| MOB-4 | Pairing UX on mobile (consumes RMT-3) | Pair to a desktop engine on the same overlay network; a full mock turn completes end to end on a real device |
| MOB-5 | Mobile smoke | The mobile route set drives a locally-hosted engine in a desktop browser at a mobile viewport, in CI. **Real-device runs are a manual pre-release checklist item in `docs/RELEASE_CHECKLIST.md`, not a CI gate** — be honest about this rather than pretending device-farm coverage exists |
| MOB-6 (HUMAN) | Play Console + App Store Connect enrolment; signing keystore; provisioning profiles | Internal-testing track / TestFlight build installs |
| MOB-7 | **App Store compliance review** | Written confirmation that the iOS build downloads and executes no code (App Store §2.5.2) — it is a remote client; all agent execution is on the paired engine. Document this in the review notes *before* the first submission, not after a rejection |

---

## Phase REL — Release engineering across four platforms

**This is where the in-flight dual-channel Windows work gets reconciled.** That work is recent and real (`b0a024cd` Azure-free Store AppX build mode, `3fdb7a19` route Store packages away from CDN, `fc011eee` Store-managed update state, `53b32f51` force Azure signing before CDN publish, `bc8db86f` self-signed CDN rejection tests) and it lives in `electron/storeChannel.js`, `electron/cdnUpdater.js`, `scripts/build-app-win.ps1`, `.github/workflows/release-windows.yml`, `docs/RELEASE_RUNBOOK.md`.

**Reconciliation policy — state it plainly so nobody guesses:**

1. **Phases CTR → SUB do not touch the release pipeline at all.** The Electron+Python stack keeps shipping through Squirrel/CDN and the Store AppX channel, unchanged, on `main`, throughout. New-stack CI (TAU-7) produces **artifacts only**, never publishes.
2. **Version scheme is shared, artifact names and manifests are not.** Both stacks use `1.{N}.0` with `N = max(git rev-list --count HEAD, published+1)` (`docs/RELEASE_RUNBOOK.md`) so version comparison stays coherent. But the Tauri artifacts get distinct names and a **separate manifest key** — extend `cdn.martinstech.net/maestro/version.json` with a `next` block rather than adding a second file, so `electron/cdnUpdater.js`'s `pickUpdate()` (which reads only `manifest.latest`) can never see a Tauri build. **An old-stack client must be structurally incapable of being handed a Tauri build before CUT.**
3. **The Windows installer format changes: Squirrel → NSIS.** Tauri has no Squirrel target. Existing Squirrel installs need a migration, and there is precedent in this repo — `electron/main.js:96 _removeLegacyNsisInstall()` did the reverse (NSIS→Squirrel) already. **REL-3** builds the mirror of it.
4. **Store AppX package identity must not change.** It is tied to the listing and to every installed user. The AppX wraps a different executable, same identity. **REL-4 is human-only** and must be confirmed with the Partner Center listing before any submission.

| # | Ticket | Acceptance gate |
|---|---|---|
| REL-1 | `.github/workflows/release-tauri-windows.yml` — NSIS + Azure Trusted Signing (reuse the `AZURE_*` secrets and the `signtool` + Trusted Signing dlib steps from `release-windows.yml`) | `node scripts/ci/verify-signature.js --require-signed` passes on the Tauri exe and installer, exactly as it does today for the Electron pair |
| REL-2 | `version.json` gains a `next` block; `tauri-plugin-updater` reads it with its own minisign keypair | Old-stack `pickUpdate()` provably ignores it (unit test); the self-signed-CDN-rejection test from `bc8db86f` has a Tauri twin |
| REL-3 | Squirrel→NSIS migration path, modelled on `_removeLegacyNsisInstall()` | On a VM with a Squirrel install, the Tauri NSIS installer installs, removes the Squirrel install and its shortcuts, and **preserves `%APPDATA%` state** (settings, credential, sessions) |
| REL-4 (HUMAN) | Store AppX submission with the Tauri payload under the unchanged package identity | Store install updates in place over an Electron-era install without data loss |
| REL-5 | `release-tauri-macos.yml` (build + sign + notarise + DMG + CDN publish) | Signed, notarised DMG published to a draft release |
| REL-6 | `release-tauri-android.yml` (AAB, signed) and `release-tauri-ios.yml` (IPA, TestFlight) | Both reach an internal testing track |
| REL-7 | `docs/RELEASE_RUNBOOK.md` + `docs/RELEASE_CHECKLIST.md` rewritten for four platforms and two stacks; the pin table gains Tauri, Rust toolchain, and the `@anthropic-ai/claude-agent-sdk` + bundled-CLI pins | A reader can produce any of the six artifacts from the doc alone |

---

## Phase CUT — Cutover and retirement

Ordered, one ticket per step, each independently revertable.

| # | Ticket | Acceptance gate |
|---|---|---|
| CUT-1 | Tauri becomes the **default download** on the CDN (`latest` points at the Tauri build; the Electron build stays published one more release as a rollback target) | Install/update telemetry-free sanity: a manual matrix of fresh-install and update paths on Windows and macOS |
| CUT-2 | One release soak. **No code changes.** | No regression reports; the Squirrel→NSIS migration confirmed working in the wild |
| CUT-3 | Delete `electron/` | `npm run verify` is retired; `verify:next` is renamed to `verify` and `package.json` `"verify"` points at `scripts/verify-next.mjs`. `e2e/golden/` is deleted; `e2e/golden-tauri/` is renamed to `e2e/golden/`. `harness/review.mjs`'s prompt is checked for stale Electron references |
| CUT-4 | Delete `backend/`, `scripts/build-python-env-win.ps1`, `scripts/strip-py-to-pyc.ps1`, `scripts/zip-python-stdlib.ps1`, `scripts/gen-icons.py` (port to Node in the same PR), `backend/requirements*.txt` | **The 6-test deselect list in `scripts/verify.mjs:45` dies with this ticket.** Update `CLAUDE.md` §Rules — the paragraph about the deselect list is the current source of truth for "did I break something" and must be replaced, not deleted, with the engine's equivalent |
| CUT-5 | Delete `engine/src/split.ts`'s proxy machinery and `MAESTRO_ENGINE_ROUTES`; delete `MAESTRO_BROWSER_ENGINE` | Engine has no Python code path; `grep -rn "python\|proxy_to_backend" engine/src` returns nothing live |
| CUT-6 | Rewrite `CLAUDE.md`, `docs/HANDOFF.md`, `docs/UPSTREAM.md`, `AGENTS.md`, `README.md`, `GETTING_STARTED.md`, `backend/CLAUDE.md`→`engine/CLAUDE.md` (the Python conventions doc becomes a TS conventions doc) | `check-fork-drift` clean; `docs/HANDOFF.md` §10 replaced by an accurate four-platform statement; no doc claims Electron or FastAPI |
| CUT-7 | Retire the Electron CDN channel; final `version.json` collapse (`next` → `latest`) | Old-stack clients on the last Electron release still receive the migration installer |

**Rollback at CUT:** CUT-1 and CUT-2 are manifest-only and revert by editing `version.json`. **CUT-3 is the point of no return** — do not merge it until CUT-2's soak has produced a clean release cycle.

---

## 3. How the quality gate is duplicated without regressing the old one

```
npm run verify        ← UNCHANGED through CUT-3. scripts/verify.mjs is frozen.
                        lint · frontend-test · typecheck · build · golden (packaged Electron)
                        · backend pytest (with its 6 named deselects) · call-home · fork-drift · i18n-parity

npm run verify:next   ← grows one section per phase:
  CTR:  test:contract · gen-contract --check · call-home · fork-drift · i18n-parity
  TAU: +tauri build · cargo test · cargo clippy -D warnings · e2e:golden:tauri
  BRW: +browser-agent e2e under both shells
  ENG: +engine lint · tsc --noEmit · vitest · check-provider-egress
  AGT: +e2e/contract/golden-turn.spec.ts against the engine (the CTR-4 file, unmodified)
  SUB: +full contract suite native (no proxy entries)
  RMT: +headless-engine contract run over a network transport
  MAC: +macOS golden (tauri-driver)
  MOB: +mobile-viewport smoke

npm run verify:all    = verify && verify:next     ← the PR gate for the whole migration
```

**Golden-smoke equivalence, concretely.** The current smoke (`e2e/golden/golden-path.spec.ts`) is boot-only by design. The migration gets **two** smokes:
- **Boot smoke** — the same three assertions, per shell: Electron (`e2e/golden/`) and Tauri (`e2e/golden-tauri/`). Same test ids, same isolation, same opaque-token seeding (`e2e/golden/fixtures.ts:14-18`).
- **Turn smoke** (new, CTR-4) — headless, shell-independent, drives a full `MAESTRO_MOCK_AGENT=1` turn over WS. Written against Python in CTR, run against the engine in AGT-6 **without editing the file**. This is the parity oracle the current gate does not have, and it is the reason a backend rewrite is auditable at all.

**CI:** `lint.yml` runs `verify:all` on PRs. `phase-tests.yml` / `e2e.yml` / `promotion-gate.yml` / `dogfood.yml` keep running the old stack unchanged; new-stack equivalents are added as **separate workflows** so a new-stack failure can never block an old-stack hotfix release.

---

## 4. How the compliance constraints are re-verified against new code

| Constraint | Old mechanism | New mechanism |
|---|---|---|
| No `*.openswarm.com` | `check-callhome.mjs` scans `frontend/build` + `electron` for 4 regexes in `.js/.html/.json/.css` | **CTR-6** extends `ROOTS` to `engine/{src,dist}`, `tauri/{src,gen}`, `contract`, and the extension set to `rs|toml|ts|tsx|mjs|kt|swift|plist|xml|yml`. The `FORBIDDEN` literals are untouched — the file's own header forbids renaming them |
| No deleted subsystem returns | `check-fork-drift.mjs` `FORBIDDEN_PATHS` + legacy-identifier grep | Add `engine/src/apps/auth/`, `engine/src/apps/subscription/`, `engine/src/outputs/publishCloud.ts` to `FORBIDDEN_PATHS`. `engine/` and `tauri/src/` are **not** added to `ALLOW_PREFIX` — only `tauri/gen/` is (vendor boilerplate) |
| Models only via Maestro / 9Router | convention + code review | **ENG-7**: a single egress chokepoint `engine/src/net/http.ts` with a host allowlist, an ESLint `no-restricted-imports` ban on every other HTTP client outside `engine/src/net/`, and `scripts/check-provider-egress.mjs` in `verify:next`. **Structural, not textual** — the right shape of guard for freshly written code |
| Licence / brand / appId | `check-fork-drift` ALLOW list; `electron/package.json` | `tauri.conf.json` `identifier` and `productName` asserted by `check-fork-drift`; AppX identity asserted in REL-4; LICENSE + NOTICE untouched |
| Runtime proof | a network capture during a MockAgent turn (DET Task 10 Step 3) | Repeat per stack: a capture during a golden turn on the Tauri build (TAU-7), on macOS (MAC-4), and from a paired mobile client (MOB-4) — the mobile one matters most, because a remote client is the first time app traffic leaves the machine |

---

## 5. Risk register (cross-phase)

| # | Risk | Likelihood | Impact | Owner phase | Mitigation |
|---|---|---|---|---|---|
| R1 | Mobile turns out to need on-device execution after all | Low | Fatal to MOB | D1 / MOB | D1 is argued from platform rules (§2.5.2, no fork/exec), not preference. If the product owner insists on on-device, the honest answer is "not with CLI-based agents" — escalate rather than fake it |
| R2 | BRW-6 (interactive login / cookie capture) does not work on external Chromium | **Medium** | Loses the social/workspace MCP connectors | BRW | Named escalation point inside BRW-6; fallback is a transitional Electron-hosted browser on Windows only. **Do not start SUB-9 until BRW-6 is green** |
| R3 | The 66k-LOC frontend behaves differently in WebView2/WKWebView | Medium | Large rework | TAU | Discovered at TAU-2, before any backend work. The phase ordering exists for this |
| R4 | Shared on-disk state corrupted by two processes | Medium | User data loss | ENG-3 | Single-owner rule, flag-enforced; atomic write + directory fsync ported and tested **on Windows without a deselect** |
| R5 | Credential-store migration logs every user out | Medium | Support incident | ENG-4 | Bidirectional read test against a real Windows profile before the flip |
| R6 | Agent-loop behavioural drift that tests do not catch | **High** | Silent quality regression | AGT | CTR-4's turn smoke + AGT-3's byte-identical MockAgent + table-driven differential tests on the provider env adapter. Plus: run both stacks side by side on the same prompt during the AGT soak |
| R7 | Migration starves the shipping product for months | **High** | Business | all | Every phase ships something: TAU ships nothing user-visible but is verifiable; the old stack ships continuously from `main` throughout. **Do not create a long-lived migration branch** — that is what `MAESTRO_ENGINE_ROUTES` exists to avoid |
| R8 | Squirrel→NSIS migration strands users | Medium | Users stuck on an old build forever | REL-3 | Modelled on the existing `_removeLegacyNsisInstall()`; VM-tested; the Electron build stays published one release past CUT-1 as a rollback target |
| R9 | Store AppX identity change orphans Store installs | Low | Irreversible | REL-4 | Human-only ticket, confirmed against Partner Center before submission |
| R10 | RMT turns a localhost app into an exploitable network service | Medium | Security | RMT | Loopback-only default, opt-in remote, TLS or overlay-network required, dedicated `/security-review` pass |
| R11 | Rust core becomes a second place where product logic accretes | Medium | Re-creates the `main.js` 3584-line problem in Rust | all | **D2a is the rule**: if a headless VPS engine needs it, it is TypeScript. Enforce in review; a Rust file that is not window/tray/updater/deeplink/sidecar/dialog is a review rejection |
| R12 | The `9router` 0.3.60→0.4.x pin decision gets smuggled into a migration ticket | Medium | Confounds a regression | ENG-6 | Explicitly out of scope (D6). Port the pin as-is |

---

## 6. Self-review

**Brief coverage:** Electron→Tauri 2 → TAU/MAC/MOB/REL. Python→TS → CTR/ENG/AGT/SUB. Lightweight → D2 (with the concrete claim: −Electron −Python, +~12MB Rust, Node reused not added) and its evidence in `electron/package.json` `extraResources`. Coexistence → D5, the `MAESTRO_ENGINE_ROUTES` splitter, and per-phase rollback tables. Mobile execution model → D1, confronted with the platform rules, a recommended default and five rejected alternatives. macOS reversal → D0, stated as new work with an explicit pointer at the HANDOFF §10 contradiction and a doc-reconciliation ticket (MAC-7). Physical layout + CI → D4 and §3. Verify duplication → §3. Compliance re-verification → §4. 9Router → D6, ENG-6, and the fact that it also owns the OAuth loopback. In-flight release pipeline → REL preamble, four numbered policies.

**Things I found that the brief did not mention and that change the plan:**
1. **The browser subsystem is a second, near-equal architectural blocker** (D3). Tauri has no `<webview>`, WKWebView has no CDP. It is not mentioned in the brief but it would have derailed the migration if discovered in phase MAC. The good news, verified in `browser_agent.py:270` / `browserCommandHandler.ts`, is that the *backend* half is already transport-agnostic — the coupling is entirely shell+frontend, so BRW is an early, independent phase.
2. **The app is already client/server over HTTP+WS with a bearer token.** That is what makes both the strangler migration and the mobile story cheap, and it is why CTR comes first.
3. **9Router owns the Keycloak OAuth loopback on port 20128** (`docs/MAESTRO.md:9,33`) — not just LLM routing. Missing this would have broken login on macOS and made mobile auth impossible.
4. **`claude-agent-sdk` has a first-party TypeScript twin.** The agent loop port is a re-expression, not a reimplementation — this is the single biggest reason the backend rewrite is tractable, and it is also why the CLI-version pin must move to the runbook (AGT-4).
5. **The current golden smoke never runs an agent turn** (its own header says so). Migrating a 45k-LOC agent backend behind a boot check would be indefensible, hence CTR-4.

**Sequencing check:** CTR is a prerequisite of everything. TAU and ENG are independent after CTR and can run in parallel worktrees. BRW needs TAU (to test in both shells) but not ENG. AGT needs ENG-1/2/3. SUB-8 needs BRW-5; SUB-9 needs BRW-6. RMT needs SUB-10. MAC and MOB are parallel after RMT. REL needs both. CUT is last and its own point of no return is CUT-3.

**Placeholder scan:** every ticket names files or a source anchor and a falsifiable gate. Three tickets are deliberately open decisions with a named escalation point rather than a fake answer: TAU-6 (CDP-vs-tauri-driver), ENG-4 (keyring library), BRW-6 (interactive login). Human-only tickets are labelled: MAC-1, MOB-6, REL-4.

**What I did not resolve:** the `mtok_…` static-key status (`docs/MAESTRO.md:79-93` — genuinely unresolved upstream of this repo; the engine must keep supporting it either way, and `e2e/golden/fixtures.ts` depends on it) and the `9router` 0.3.60→0.4.x pin (deliberately out of scope, D6).

---

### Critical Files for Implementation

- `C:\Users\gsilva\maestro-desktop\electron\main.js` — 3584 lines; the source of truth for everything phase TAU must reproduce in Rust (backend spawn `:911`, restart policy `:1812`, splash `:588`, menu `:1193`, updater `:1674`, CDP routes `:3439`, main bridge `:3025`)
- `C:\Users\gsilva\maestro-desktop\backend\main.py` — auth middleware `:97`, CORS `:80`, and all three WebSocket endpoints `:155,:258`; the contract CTR-1/CTR-2 freeze
- `C:\Users\gsilva\maestro-desktop\frontend\src\shared\config.ts` and `C:\Users\gsilva\maestro-desktop\frontend\src\shared\ws\WebSocketManager.ts` — the client half of the seam; TAU-1's blast radius and RMT-2's entire scope
- `C:\Users\gsilva\maestro-desktop\backend\apps\nine_router\process.py` — 9Router supervision (ENG-6), and the reason port 20128 is load-bearing for auth
- `C:\Users\gsilva\maestro-desktop\scripts\verify.mjs` — the frozen old-stack gate that `scripts/verify-next.mjs` must mirror without touching (its 6-name deselect list at `:45` is the "did I break something" oracle until CUT-4)

# Maestro as a first-class subscription provider

**Status:** design only, not implemented. **Do not implement before AGT-1 lands** (see §6). This
doc does not touch code; `backend/**` and `electron/**` were read-only for its authoring and a
live Phase-AGT workflow was porting `registry.py`/`configure_provider_env.py` to
`engine/src/agents/providers/` at the time of writing.

**Ask (revised, more specific than the first pass of this doc):** Maestro must appear in the
Settings UI as a **peer of Claude Pro/Max and ChatGPT Plus/Pro** — in the same list/section they
occupy (`frontend/src/app/pages/Settings/sections/subscription/`), not in the custom-providers
section — and its model list must be sourced **dynamically** from the gateway, not hardcoded, with
an explicit answer for what happens on failure/offline and how that reconciles with the catalog
constants and priority lists that already exist in the codebase.

---

## 0. TL;DR

- **The central 9Router question (unchanged from the first pass, re-stated in §1): no, 9Router
  cannot be taught a native Maestro OAuth vendor without a fork; yes, Maestro is already registered
  inside it at runtime as a generic `cp-maestro` openai-compatible provider-node.** That answer does
  not change with the more specific ask — it explains *why* Maestro isn't rendering as a
  subscription today (the subscription list is wired to 9Router's three compiled vendors), not
  whether it's achievable (it is, because the fix is entirely in our own UI/registry code).
- **Requirement 1 (peer of Claude/Codex) is answered precisely in §2, with file-and-line anchors.**
  The short version: `SUBSCRIPTION_PROVIDERS` (`subscriptionProviders.ts`) is a hardcoded array of
  3 — adding a 4th entry is trivial. The real work is in `SubscriptionCards.tsx`: every card today
  assumes its connected/disconnected state and its Connect flow come from 9Router (`GET
  /api/providers` via `selectSubscriptionConnections`, `POST /agents/subscriptions/{connect,
  disconnect}`). Maestro has neither — its status comes from `GET /api/settings/maestro/
  token-status` (already built, already polled by `MaestroSessionGate.tsx`) and it needs one **new**
  backend/engine route, `POST /api/settings/maestro/logout`, that does not exist today. §2.2 lists
  every file this touches.
- **Requirement 2 (dynamic model list) — mostly already built, confirmed by reading the code, not
  assumed.** `backend/apps/agents/agents.py`'s `GET /agents/models` handler already groups Maestro's
  models under a `"Maestro"` key sourced from `settings.custom_providers` (line 813 onward) and
  explicitly re-sorts it to head the picker (lines 844-848, `if MAESTRO_NAME in result: result =
  {MAESTRO_NAME: …, …}`). Those models come from `maestro_catalog.py`'s live `GET /v1/models` fetch
  against the gateway, cached 15 minutes, falling back to a shipped 4-model constant only when the
  live fetch has never succeeded. `frontend/src/app/Main.tsx`'s `DEFAULT_MODEL_PRIORITY`/
  `DEFAULT_MODEL_PICKS` (lines 277-289) already list Maestro first with its own preferred default.
  **None of this needs to change for requirement 2.** What's new is only the same UI/status-source
  problem as requirement 1: the *subscription card* needs its own read of "is there a usable
  catalog," which is a restatement of the token-status question, not a new catalog mechanism.
- **I could not verify `GET /v1/models` live, and I'm saying so rather than guessing.** Two
  independent blockers, both real: (a) this sandbox has no general internet egress — `curl
  https://llm.martinstech.net/v1/models` failed on DNS resolution after a 10s timeout, not a 401 or
  any application-level response; (b) even with network, this machine has no usable credential —
  `docs/plans/txm-status.md`'s ENG-4 row records that a destructive Windows-credential-store read
  bug, discovered and fixed during that ticket, zeroed out this machine's real stored Keycloak
  refresh token as a side effect, and the app's own `refresh_catalog()` (`maestro_catalog.py:150-153`)
  deliberately refuses to send an unauthenticated request in the first place ("the gateway throttles
  at 10 failed auths a minute, so a tokenless probe costs more than it can return"). So there is no
  path to a live re-verification from here without either a human completing a real Keycloak login
  or deliberately abusing the gateway's auth throttle for no real signal — I did neither. §2.3 designs
  against the two things that ARE verified: `docs/MAESTRO.md`'s dated, live-checked contract (`GET
  /v1/models` → 200, `{"object":"list","data":[…]}`, id-only rows, 4 models) and `parse_catalog()`'s
  own defensive parsing (only `data[].id` is read; nothing else in the response is trusted). I am not
  inventing a richer response shape than either of those documents.
- **The Connect/Disconnect UX tension is resolved, not left open.** Recommendation (§2.4): Maestro's
  card never shows a "Connect" button in normal operation — `MaestroSessionGate.tsx`'s existing
  auto-trigger-on-missing/expired behavior is untouched, so by the time a user opens Settings the
  card is already reading "Connected" the overwhelming majority of the time, exactly like Claude/
  Codex look once actually connected. "Sign in" only appears on the card in the same rare states the
  gate itself would show a snackbar (missing/expired with auto-trigger not yet resolved) and reuses
  the existing `startMaestroLogin` action verbatim. **"Disconnect" is renamed "Sign out" for this one
  card and does something semantically different** (Keycloak logout: clear the stored access token
  and delete the OS-credential-store refresh token) rather than deleting a 9Router connection object
  that doesn't exist for Maestro. This is a deliberate, visible asymmetry, not a gap papered over.
- **Implementation target and sequencing: unchanged from the first pass — the TS engine, strictly
  after AGT-1's gate passes** (§6). The scope actually shrank on inspection: the catalog/grouping
  logic needs no new registry work (it already works), so this is now almost entirely a Settings-UI
  + two small backend/engine endpoints change, which lowers both the cost and the AGT-collision risk
  from the first pass.

---

## 1. The central 9Router question (unchanged from the first pass)

### 1.1 What "subscription" means in this codebase today

`frontend/src/app/pages/Settings/sections/subscription/subscriptionProviders.ts` hardcodes exactly
three entries:

```ts
export const SUBSCRIPTION_PROVIDERS = [
  { id: 'claude', name: 'Claude Pro / Max', … },
  { id: 'antigravity', name: 'Gemini Advanced', … },
  { id: 'codex', name: 'ChatGPT Plus / Pro', … },
];
```

`SubscriptionCards.tsx` renders one card per entry, `POST /agents/subscriptions/connect` starts an
OAuth flow, and connection status is read from 9Router's own `GET /api/providers` (`isActive`,
`testStatus`). This is `backend/apps/nine_router/oauth.py`'s `start_oauth`/`poll_oauth`/
`exchange_oauth`, all of which are thin proxies to **9Router's own compiled OAuth logic** for
exactly those three vendors (plus `github`/`kiro`/`qwen`, not surfaced as subscription cards).
9Router owns: the vendor's OAuth client id, the device-code/authorize/token endpoints, refresh-
token rotation, and (per `registry.py`'s `NINEROUTER_MODEL_PREFIXES`) a per-vendor request/response
translator tuned against each vendor's real API shape. None of that is data you can POST in; it's
compiled into the pinned npm package.

### 1.2 What 9Router's provider-node API actually lets you register at runtime

`backend/apps/nine_router/sync_custom.py` is the proof this is possible without a fork, because the
app already does it for two unrelated cases:

1. **User-typed custom providers** (`sync_custom_providers`, lines 156-311): for each
   `settings.custom_providers[]` entry, `POST /api/provider-nodes` with
   `{name, prefix: "cp-<slug>", apiType: "chat", baseUrl, type: "openai-compatible"}`, then `POST
   /api/providers` with `{provider: <node id>, authType: "apikey", apiKey, priority: 0}`. This is a
   pure HTTP call against an already-running 9Router; no code in 9Router is touched.
2. **Maestro itself, already**: `apply_maestro_defaults.py:9-13`'s own docstring —
   *"Integration path is a seeded custom provider rather than a BUILTIN_MODELS lane: the gateway
   speaks OpenAI, the agent loop speaks Anthropic, so the wire has to cross 9Router's translator
   either way, and custom_providers already does exactly that end to end."* Maestro rides the
   generic `sync_custom_providers` path because `apply_maestro_defaults.py:87-109` inserts a
   `CustomProvider(name="Maestro", …)` into `settings.custom_providers` at index 0 on every settings
   load/write.

So: **Maestro is already a registered 9Router provider node, today, via the same mechanism a
fork-free "register at runtime" design would use.** The routing problem is already solved; it just
isn't *presented* as a subscription.

What this mechanism can never give Maestro: a 9Router-native OAuth handshake (`GET
/api/oauth/maestro/authorize`), because 9Router has no `maestro` provider compiled in, and no
runtime API to teach it one. `authType` on a provider-node connection is one of a fixed, compiled
enum (`apikey`/`oauth`/`device_code`, wired to specific vendor logic); it isn't a template engine.

### 1.3 The `9router_gpt5_patch.js` existence proof — and why it doesn't change the answer

The task that produced the first pass of this doc named this file specifically as "the existence
proof for how far this technique goes." Read in full, it does three things via `node --require`, all
**Node-runtime-level**, none **9Router-application-level**: force loopback binding on `net.Server`;
intercept one specific inbound path (`/callback?...`) on `http.Server.prototype.emit` and proxy it
server-to-server into the Maestro/Keycloak backend; and rewrite outbound JSON bodies **only** when
the destination hostname is `api.openai.com` and the model looks like `gpt-5*`. This is real
leverage — it's how Maestro's own Keycloak OAuth loopback callback piggybacks on 9Router's
already-open port 20128 — but none of it touches 9Router's provider registry, OAuth vendor table, or
its own bundled admin UI (which this app's frontend doesn't even render). You cannot `--require`-
patch your way to "Maestro" appearing as a `device_code` provider inside 9Router's compiled OAuth
switch statement without rewriting that switch statement, i.e. forking.

### 1.4 Answer

**9Router cannot be taught a new native subscription vendor without a fork.** It can, and already
does, host Maestro as a generic OpenAI-compatible provider-node, which is sufficient for *routing*
but insufficient for *presentation*, because the subscription surface in our own UI is wired
specifically to 9Router's `/api/providers` connection list and its three compiled vendors. Making
Maestro a fourth *card* in our own Settings UI requires nothing from 9Router — it requires our UI
to stop sourcing Maestro's presentation from the custom-provider code path and start sourcing it
from Maestro's own, already-built token-status/login machinery. That's §2.

---

## 2. Requirement 1: Maestro as a peer of Claude/Codex in the Subscriptions section

### 2.1 What actually makes an entry render there today (the exact mechanism, with anchors)

Three pieces, in order, all in `frontend/src/app/pages/Settings/sections/subscription/`:

1. **The list source** — `subscriptionProviders.ts:2-7`, the `SUBSCRIPTION_PROVIDERS` array quoted
   in §1.1. This is the only thing that decides which cards exist at all. Nothing here talks to a
   backend; it's a static UI catalog of id/name/desc/color.
2. **The renderer + state wiring** — `SubscriptionCards.tsx`. For each entry in
   `SUBSCRIPTION_PROVIDERS`, it renders a `<SubscriptionCard>` (`SubscriptionCard.tsx`) whose
   `connected` prop comes from:
   ```ts
   const connections = useAppSelector(selectSubscriptionConnections);   // line 38
   const isConnected = (providerId: string) =>
     connections.some(p => p.provider === providerId && (p.isActive || p.testStatus === 'active')); // lines 75-79
   ```
   `selectSubscriptionConnections` reads `subscriptionsSlice`, which is populated by
   `fetchSubscriptionStatus` — a thunk that calls `GET /agents/subscriptions/status`
   (`backend/apps/agents/agents.py:406`), which is 9Router's `GET /api/providers` reshaped. **This is
   the crux of the gap**: `isConnected` structurally cannot return true for `providerId === 'maestro'`
   today, because 9Router has never heard of a provider literally named `maestro` (§1) — there is no
   connection object with `provider: 'maestro'` for it to match against, ever, regardless of whether
   the user is actually signed in.
3. **The connect/disconnect verbs** — `SubscriptionCards.tsx:81-124`'s `handleConnect`/
   `handleDisconnect`, which `POST /agents/subscriptions/connect` / `POST
   /agents/subscriptions/disconnect` (`agents.py:418`, `:879`) and then hand the response to
   `subscriptionConnect.ts`'s `runConnectFlow`, which branches on `data.flow === 'device_code' |
   'authorization_code'` — both shapes 9Router's `start_oauth` produces (`nine_router/oauth.py:259-
   306`). Maestro's login (`maestro_keycloak_auth.build_authorize_url`) produces neither shape; it's
   a different function entirely, already wired into a different endpoint (`POST
   /api/settings/maestro/login/start`, `settings.py:310-323`), consumed by a different piece of the
   frontend (`maestroSlice.ts`'s `startMaestroLogin`, used today only by `MaestroSessionGate.tsx`).

So the gap is exactly as precise as this: **`SubscriptionCards.tsx` has no code path that can ever
be true for a provider whose truth lives outside 9Router's connection list**, because every
provider it knows about is assumed to be a 9Router vendor. Adding Maestro to
`SUBSCRIPTION_PROVIDERS` alone would render a fourth card that is permanently stuck in "Connect" and
whose Connect button 404s or no-ops, because `POST /agents/subscriptions/connect` has no `maestro`
case (confirmed: `agents.py`'s `/subscriptions/connect` handler is 9Router-only, no branch for a
non-9Router provider id).

### 2.2 What has to change, file by file

| File | Change |
|---|---|
| `frontend/src/app/pages/Settings/sections/subscription/subscriptionProviders.ts` | Add a 4th entry: `{ id: 'maestro', name: 'Maestro', desc: "Maestro Studio's own AI models", descKey: 'settings.models.providers.maestroDesc', color: <brand token>, preview: false }`. First in the array (or explicitly sorted first in the renderer) so it heads the list the same way it already heads the model picker (`agents.py:844-848`). |
| `frontend/src/app/pages/Settings/sections/subscription/SubscriptionCards.tsx` | Special-case `providerId === 'maestro'` in exactly three spots: (a) `isConnected` — for Maestro, read `useAppSelector(s => s.maestro.status)` (already populated by `fetchMaestroTokenStatus`, already dispatched app-wide by `MaestroSessionGate`) and treat `state === 'valid' \| 'expiring' \| 'opaque'` as connected, `'missing' \| 'expired'` as not — this is `maestro_token_status.py`'s own `needs_login()` predicate, already computed server-side, just not read by this component yet; (b) `handleConnect` — for Maestro, `dispatch(startMaestroLogin())` instead of `POST /agents/subscriptions/connect`; (c) `handleDisconnect` — for Maestro, call a new `maestroLogout` thunk (§2.2 next row) instead of `POST /agents/subscriptions/disconnect`. No changes needed to `SubscriptionCard.tsx` itself — it already renders purely off `connected`/`connecting`/`disconnecting` booleans regardless of what feeds them. |
| `frontend/src/shared/state/maestroSlice.ts` | New thunk, mirroring `startMaestroLogin`'s existing shape (lines 52-64): `maestroLogout`, `POST ${SETTINGS_API}/maestro/logout`, then re-dispatch `fetchMaestroTokenStatus` so the card flips to "Sign in required" without waiting for the next poll. |
| `backend/apps/settings/settings.py` | New additive route next to the existing pair at lines 300-323: `POST /maestro/logout` — clears `settings.provedor_ia_token` (save), then calls `maestro_credential_store.clear_refresh_token()` (already exists, `maestro_credential_store.py:50` — this ticket adds zero new credential-store code, only calls what's there). |
| `engine/src/settings/*` (once its HTTP route layer exists — see §6) | Same route, calling the already-ported `clearRefreshToken()` (`engine/src/settings/credentialStore.ts:466`, confirmed present) plus clearing `provedor_ia_token` via the engine's settings store. |

Everything in this table is additive: a new array entry, three read/dispatch branches in an
existing component, one new thunk, one new backend route calling an existing credential-store
function, one new engine route calling its already-ported twin. Nothing in `registry.py`/
`apply_maestro_defaults.py`/`sync_custom.py` needs to change for requirement 1 — the model-picker
grouping and the 9Router routing already work (§2.3 confirms this for requirement 2 as well); this
requirement is purely about the *separate* Settings→Subscriptions surface, which today simply never
looks at Maestro's status at all.

### 2.3 Requirement 2: the model list, verified as far as this environment allows

**What already exists, confirmed by reading the code (not assumed):**

- `backend/apps/agents/agents.py`'s `GET /agents/models` handler (`list_models`, line 611 on)
  iterates `settings.custom_providers` (line 813) and, for the Maestro entry, emits `result["Maestro"]
  = entries` (line 842) where `entries` are whatever `CustomProvider.models` currently holds — then
  explicitly re-sorts so `MAESTRO_NAME` heads the returned dict (lines 844-848: *"provedor-ia is the
  app's own gateway, so it heads the picker instead of trailing the third-party groups"*). This is
  the dynamic, already-correct answer to "how does the picker group Maestro's models" — nothing to
  build here.
- `CustomProvider.models` for the Maestro entry is populated by `maestro_provider()`
  (`apply_maestro_defaults.py:61-75`): `catalog_models() or MAESTRO_MODELS` — the **live** catalog
  when fresh, else the shipped 4-model constant.
- The live fetch is `maestro_catalog.refresh_catalog()` (`maestro_catalog.py:141-174`): `GET
  {MAESTRO_DEFAULT_PROXY_URL}/models` (i.e. `https://llm.martinstech.net/v1/models`) with `Authorization:
  Bearer <token>`, parsed by `parse_catalog()` (lines 77-109), which reads **only** `payload["data"][
  ].id`, discarding every other field the response might carry, and returns `None` (keep whatever's
  cached) on any non-200, non-JSON, or empty-data response — never raises, never blocks a hot path.
- Caching: `remember_catalog()`/`catalog_models()` (lines 112-137) — a 15-minute TTL
  (`CATALOG_TTL_SECONDS = 900`), read through a synchronous accessor because
  `apply_maestro_defaults` runs on every settings load/write and a network call there would block
  the app.
- Refresh triggers: `refresh_maestro_catalog.py` — called from the settings-app lifespan at startup
  and again right after a token is stored (a fresh sign-in immediately seeds the live catalog in the
  same write, per that module's own docstring).
- **Offline/failure behavior, already decided by the existing code, not something this design needs
  to invent**: if the live fetch has never succeeded (cold start with no cached catalog, or every
  attempt so far failed), `maestro_provider()` falls back to the shipped `MAESTRO_MODELS` constant
  (`maestro.py:42-51`, the same four ids the gateway documented in `docs/MAESTRO.md`'s verified
  table) — the user always sees a working, non-empty Maestro group, never a blank or errored section.
  Once *any* fetch succeeds, the cache takes over until it goes stale (15 min) or the app restarts
  cold again. There is no "show an error state" branch anywhere in this path, and this design does
  not add one — it matches the rest of the app's subscription-health philosophy (`subscription_
  health.py`'s own comment: *"silence beats a false reconnect prompt"*).

**What I attempted to verify live, and could not, stated explicitly per the task's instruction not
to fabricate a response shape:**

```
$ curl -sS -i --max-time 10 https://llm.martinstech.net/v1/models
curl: (28) Resolving timed out after 10008 milliseconds
```

This sandbox has no general internet egress (DNS resolution itself times out — not a connection
refusal, not a 401, not any signal about the gateway's actual behavior). Independently, this
specific machine cannot make an authenticated call regardless of network: `docs/plans/
txm-status.md`'s ENG-4 row records that a destructive Windows-credential-store read bug (found and
fixed while building `engine/src/settings/credentialStore.ts`) zeroed out this machine's real stored
Keycloak refresh token as a side effect of the investigation — *"this machine's Maestro Studio login
is now signed out and will need to re-authenticate via Keycloak on next launch."* And even ignoring
both blockers, the real code path deliberately never attempts an unauthenticated probe in the first
place (`maestro_catalog.py:150-153`'s own guard and comment: a tokenless request would just burn the
gateway's 10-failed-auths-per-minute throttle for nothing). So there is no responsible path to a
fresh live check from here short of a human completing an actual Keycloak login first — which is
out of scope for a design doc.

**What this design is built against instead, both independently corroborating an OpenAI-standard
`/v1/models` shape:**

1. `docs/MAESTRO.md`'s own dated, live-verified table (2026-08-13): `GET /v1/models` → **200**,
   `{"object":"list","data":[…]}`, id-only rows, catalog of exactly four: `maestro`, `maestro-fast`,
   `maestro-ultra`, `maestro-code`, all `owned_by: martinstech`.
2. `parse_catalog()`'s own contract (§ above) — it reads `data[].id` and nothing else, so even if
   the gateway's real response carries additional fields (label, pricing, context window — the
   `docs/MAESTRO.md` table says it does not), the app already tolerates their presence or absence
   identically. There is nothing in this design that depends on a richer shape than that.

**Reconciling with the other hardcoded model lists (the specific ask):**

| Static list | What it actually is | Does it need to change? |
|---|---|---|
| `backend/apps/settings/maestro.py`'s `MAESTRO_MODELS` | The **offline fallback constant** for when the live catalog has never been fetched successfully — `maestro_provider()`'s own `catalog_models() or MAESTRO_MODELS` makes this explicit. | **No.** This is the deliberate safety net described above, not a competing source of truth. Keep it. |
| `backend/apps/agents/providers/registry.py`'s `BUILTIN_MODELS` | The real, hand-maintained catalogs for Anthropic/OpenAI/Google — vendor models that genuinely don't change without a code release (new Claude/GPT/Gemini versions ship as PRs). Maestro is **not** in this table today (`apply_maestro_defaults.py`'s own docstring explains why: it rides `custom_providers`, not a `BUILTIN_MODELS` lane). | **No.** Nothing about this design requires adding a `Maestro` key here — the custom-provider path already produces the same dynamic, correctly-grouped, correctly-prioritized result (§2.3 above). Adding a parallel static entry would create a second, competing source of Maestro model data for no benefit. |
| `frontend/src/app/Main.tsx`'s `DEFAULT_MODEL_PRIORITY` / `DEFAULT_MODEL_PICKS` (lines 277-289) | Not model *data* at all — an ordered list of provider-group names to try, plus a preferred model id per provider, used only as the fallback when a user's stored `default_model` becomes unreachable. Confirmed: `MAESTRO_PROVIDER_NAME` already heads `DEFAULT_MODEL_PRIORITY`, and `DEFAULT_MODEL_PICKS[MAESTRO_PROVIDER_NAME] = [MAESTRO_DEFAULT_MODEL]` (`'custom/maestro/maestro-fast'`) is already the first thing it tries, operating against whatever `byProvider["Maestro"]` the already-dynamic `/agents/models` response contains. `docs/HANDOFF.md`'s mention of this array (§9, "old-brand strings") is about a stale copy/brand cleanup, unrelated to this design. | **No.** Already correct, already dynamic underneath, nothing to reconcile. |

The only genuinely new "does the catalog need a status source" question is for the *subscription
card* itself (§2.2): the card's connected/disconnected read is the token-status question, not a
separate catalog-freshness question — a user with a valid token but a momentarily-stale (>15 min old)
cached catalog still sees "Connected" and still gets a full (if slightly stale) model list, which is
correct: the catalog's own staleness is invisible and inconsequential to whether the *subscription*
is active.

### 2.4 Resolving the Connect/Disconnect UX tension — concrete recommendation

The first pass of this doc flagged, as an open risk, that a "Connect" card could read as a
regression against Maestro's fully automatic sign-in. Resolved as follows, not left open:

- **No behavioral change to the automatic sign-in.** `MaestroSessionGate.tsx`'s existing
  effect (lines 48-52: auto-fire `startMaestroLogin` the moment status is `missing`/`expired`,
  once per dead streak) is untouched by this design. The subscription card is a **status mirror**
  layered on top of that existing gate, not a new gate that requires a click before anything works.
- **The card's "Connect" state is therefore rare in practice**, appearing only in the same narrow
  window the gate's own snackbar would appear (auto-trigger already fired but the browser round-trip
  hasn't landed yet, or a genuinely dead refresh token needing a fresh login) — the overwhelming
  common case is the user opening Settings and seeing "Connected" immediately, exactly matching how
  Claude/Codex look once actually connected. When it *does* show "Sign in", clicking it dispatches
  the exact same `startMaestroLogin` action the gate already uses — no second implementation.
- **"Disconnect" is deliberately renamed "Sign out" for this one card, and does something
  semantically different, on purpose, not by oversight.** The other three cards' Disconnect deletes
  a 9Router connection object; Maestro has none to delete (§1.4). "Sign out" instead: clears
  `provedor_ia_token` from settings and calls `clear_refresh_token()` — a real logout, which means
  the *next* app launch requires a fresh Keycloak login, not just "this session stopped routing
  through Maestro." This is a heavier action than the other three cards' Disconnect (which just
  drops a routing connection the user can trivially reconnect), so:
  - Copy is explicit: **"Sign out"**, not "Disconnect" (i18n key `settings.models.subscriptionCard.
    maestroSignOut`, distinct from the shared `disconnect` key the other three use).
  - It is deliberately *not* wired through the same hover-reveal micro-interaction
    `SubscriptionCard.tsx` uses for the other three (`.sub-rest`/`.sub-undo` opacity swap on hover,
    lines 28-30) without a beat of friction — reuse the same visual affordance for consistency, but
    treat this as a place a future confirm-dialog ticket could add friction if real users
    accidentally trigger it; not required for this design's first cut, called out so it isn't
    silently skipped.
  - Because sign-out is a real Keycloak logout, it is *not* undone by reconnecting a moment later
    the way a 9Router disconnect/reconnect is — the user goes through the real browser login flow
    again. This is expected and correct, not a bug to paper over.

This makes the four cards **visually uniform** (same component, same Connected/Sign-in/Sign-out
states) while being **honestly non-uniform underneath** where the underlying mechanism genuinely
differs — which is the only sustainable way to reconcile "must look like a peer" with "is not
actually the same kind of thing."

---

## 3. Non-goals / explicitly out of scope

- **Bumping 9Router past 0.3.60.** Irrelevant to this design — Maestro never rode any of 9Router's
  vendor-specific translators; it uses the generic `openai-compatible` node type, stable across the
  pin (`process.py:36`'s pin-rationale comment lists only `cc/claude-opus-4-8`, `cx/gpt-5.5`, and
  cross-provider WebSearch as bump motivations, none of which concern the `cp-maestro` lane).
- **A 9Router fork or an upstream feature request to it.** Answered in §1.
- **Giving Maestro real usage/quota numbers.** `docs/MAESTRO.md`'s verified table found no billing/
  quota/profile endpoint on the gateway ("All other paths (~30 tried): 404"); the other three
  subscription cards show no quota either. A connected/disconnected pill is full parity.
- **Adding a `Maestro` key to `registry.py`'s `BUILTIN_MODELS`.** Explicitly considered and rejected
  in §2.3 — the custom-provider path already produces the correct, dynamic, correctly-prioritized
  result; a parallel static entry would only create a second source of truth.
- **Changing the Keycloak flow itself, its redirect URIs, or its client id.** `docs/MAESTRO.md`'s
  "these values are exact and should not be altered" instruction stands untouched.
- **A confirm-dialog on "Sign out."** Flagged in §2.4 as a reasonable follow-up, not included in
  this ticket set — first cut matches the other three cards' immediate-action pattern.

---

## 4. Design summary (what actually gets built)

| Layer | Today | Change |
|---|---|---|
| Subscription list (`subscriptionProviders.ts`) | 3 hardcoded 9Router-vendor entries | +1 entry, `id: 'maestro'`, headed first |
| Subscription cards (`SubscriptionCards.tsx`) | `isConnected`/Connect/Disconnect all assume 9Router (`/api/providers`, `/agents/subscriptions/*`) | 3 special-cased branches for `providerId === 'maestro'`, reading `maestroSlice`'s status and dispatching `startMaestroLogin`/new `maestroLogout` instead |
| Card component (`SubscriptionCard.tsx`) | Generic connected/connecting/disconnecting renderer | **Unchanged** — already generic enough |
| Backend/engine — token status | `GET /api/settings/maestro/token-status` | **Unchanged**, already exists, already correct |
| Backend/engine — login | `POST /api/settings/maestro/login/start` | **Unchanged**, already exists |
| Backend/engine — logout | Does not exist | **New**: `POST /api/settings/maestro/logout`, calling the already-existing `clear_refresh_token()`/`clearRefreshToken()` |
| Model catalog grouping (`agents.py`'s `/agents/models`) | Dynamic, correctly prioritized | **Unchanged**, already correct (§2.3) |
| Model catalog source (`maestro_catalog.py`) | Live `GET /v1/models`, 15-min TTL cache, offline fallback to `MAESTRO_MODELS` | **Unchanged**, already correct (§2.3); not re-verified live this session (see §2.3's honest verification-blocked note) |
| Custom-providers editor (`CustomProvidersEditor.tsx`) | Shows the seeded "Maestro" row like any other custom endpoint, editable/deletable | Out of this ticket set's critical path, but still a real, demonstrated gap (confirmed: zero `Maestro`/`managed` references in that file) worth closing in the same pass — see MSB-4 |

---

## 5. Risks, and what would make this not worth doing

| Risk | Detail | Mitigation |
|---|---|---|
| **Two visually-identical cards, different semantics underneath** | A user who understands "Disconnect" from the other three cards might expect "Sign out" to behave the same (reconnect instantly) and be surprised by a real logout. | §2.4's explicit copy distinction (`Sign out`, not `Disconnect`) plus documenting the asymmetry here so a reviewer doesn't "fix" it into false consistency. |
| **The model-catalog half of this design rests on a doc, not a fresh live check** | §2.3 is explicit that the gateway's actual current response was not re-verified this session — `docs/MAESTRO.md`'s table is from 2026-08-13 and the gateway could have changed since. | Low risk in practice: `parse_catalog()`'s defensive parsing (only reads `id`) means even an enriched or slightly different response degrades gracefully; the real exposure would be if the gateway *stopped* being OpenAI-shaped entirely, which would be a bigger, separately-noticed break unrelated to this design. Whoever implements MSB-1..5 should do a real authenticated check as part of that work, once a valid credential exists again on a dev machine. |
| **Timing collision with live AGT work** | Doing this concurrently with AGT-1..AGT-6 risks merge conflicts on files those tickets are actively creating. | Sequenced explicitly after AGT-1's gate in §6; this design's scope (mostly frontend + two small Settings routes) has **less** surface overlap with AGT than the first pass of this doc assumed, since no registry.ts change is needed (§2.3). |
| **Migration touches a shared on-disk file during TXM's coexistence window** | Per TXM's D5, both an old Electron+Python build and a new Tauri+engine build may run against the same `settings.json` during the transition. | MSB-4's `managed_kind` marker (if pursued) must stay additive-only, exactly as scoped — no structural move of `custom_providers[]`. |
| **Is any of this worth it given the plumbing already works?** | The routing, auth, refresh, and catalog-grouping all already function correctly (§2.3, §1.4). The remaining work is real but genuinely small: one array entry, three read/dispatch branches, one new backend route calling an existing function, one new engine route calling its already-ported twin. | Given how small the actual gap is once verified line-by-line (this revision cut the original ticket set roughly in half by discovering the catalog/grouping work was already done), the cost side of this tradeoff is now cheap enough that the presentational win (Maestro genuinely looks like a peer, not a paste-a-key afterthought) is a reasonable call either way. |

---

## 6. Where this lands relative to TXM — and why

**Recommendation: implement in `engine/src/`, as a follow-on ticket sequenced strictly after AGT-1's
gate passes — not Python, not concurrently with AGT.** Reasoning, updated for this revision's
narrower scope:

1. **`backend/apps/agents/**` and the Python-side Settings-app routes are deleted/replaced in TXM's
   later phases.** A Python-only implementation of the new logout route is thrown away work once the
   engine's equivalent `/api/settings/maestro/*` surface is wired (already flagged as an open gap in
   ENG-5's own status row: *"no HTTP route yet exposes 'start a Maestro login' from the engine"*) —
   this design's logout route is the same category of missing wiring, best done in the same pass as
   whoever closes that gap.
2. **AGT-1 is live right now, and this design no longer touches the files it's porting.** Unlike the
   first pass of this doc (which proposed a `registry.ts` change), this revision's §2.3 finding means
   **no registry change is needed at all** — the model-grouping logic that already works in
   `agents.py` has to be ported to the engine's equivalent list-models handler regardless of this
   design (it's in scope for whichever SUB-phase ticket ports `/api/agents/models`), and this design
   adds no new requirement on top of that port. The actual new surface (§2.2's table) is Settings-app
   routes and frontend — orthogonal to `engine/src/agents/providers/registry.ts`.
3. **The frontend and Settings-app prerequisites are further along than Python's, not behind it.**
   `engine/src/settings/keycloakAuth.ts` (ENG-5) already has `startMaestroLogin`/
   `completeMaestroLoginCallback`/`refreshMaestroAccessTokenIfNeeded`; `engine/src/settings/
   credentialStore.ts` already has `clearRefreshToken` (confirmed, line 466). What's missing per
   `txm-status.md`'s own "Deferred / blocked" list is exactly the HTTP route wiring — this design's
   logout route is naturally built alongside whichever ticket closes that gap, not as separate,
   unrelated work.
4. **Sequencing:** land this after **AGT-1** (so the live port isn't disturbed) and it can proceed in
   parallel with AGT-2..AGT-7 rather than waiting for AGT-6, since none of §2's file list overlaps
   the agent-loop/WS/turn-runner/proxy files those tickets own. The natural bundling point is
   whichever ticket in Phase SUB ports `backend/apps/settings/settings.py`'s remaining routes (the
   Maestro OAuth trio at lines 300-323 plus this design's new logout route) to the engine.

---

## 7. Ticket breakdown

Matches the acceptance-gate style of `docs/plans/2026-08-31-txm-tauri-typescript-migration.md`.
Phase name **MSB** (Maestro Subscription), sequenced after AGT-1, independent of AGT-2..AGT-7.

### MSB-1 — Settings UI: Maestro as a 4th subscription card
**Files:** `frontend/src/app/pages/Settings/sections/subscription/{subscriptionProviders.ts,
SubscriptionCards.tsx}`
**Do:** add the `maestro` entry to `SUBSCRIPTION_PROVIDERS` (§2.2). In `SubscriptionCards.tsx`,
special-case `providerId === 'maestro'` for `isConnected` (read `s.maestro.status`, treat
`valid`/`expiring`/`opaque` as connected), `handleConnect` (`dispatch(startMaestroLogin())`), and
`handleDisconnect` (dispatch the new `maestroLogout` thunk from MSB-2). No change to
`SubscriptionCard.tsx`.
**Gate:** with a valid Maestro token, the Settings → Subscriptions list shows 4 cards, Maestro's
reading "Connected" with no click required; with the token cleared (simulating MSB-2's sign-out),
it reads "Sign in required" and clicking it fires the exact same request `MaestroSessionGate`'s
auto-trigger does (verify via network inspector: identical `POST /api/settings/maestro/login/
start` call).

### MSB-2 — Backend + engine: Maestro logout endpoint
**Files:** `backend/apps/settings/settings.py` (additive route, next to lines 300-323); engine
equivalent once its `/api/settings/maestro/*` HTTP layer exists (§6); `frontend/src/shared/state/
maestroSlice.ts` (new `maestroLogout` thunk, mirroring `startMaestroLogin`'s shape at lines 52-64)
**Do:** `POST /maestro/logout` clears `settings.provedor_ia_token` (save) and calls the
already-existing `clear_refresh_token()` (`maestro_credential_store.py:50`) /
`clearRefreshToken()` (`engine/src/settings/credentialStore.ts:466`). No new credential-store
logic — this ticket only calls what's already there.
**Gate:** after sign-out, `GET /api/settings/maestro/token-status` reads `missing`; a subsequent app
restart does not silently re-authenticate (the credential-store entry is genuinely gone — verify by
inspecting the OS credential store directly, not just the in-memory token); `MaestroSessionGate`'s
existing auto-trigger fires again on the next boot exactly as it would for a never-signed-in user.

### MSB-3 — i18n + copy for the asymmetric "Sign out" affordance
**Files:** `frontend/src/shared/i18n/{en,pt-BR}.json` (pt-BR is the default locale per root
`CLAUDE.md`; both must land together, gated by `scripts/check-i18n-parity.mjs`)
**Do:** add `settings.models.subscriptionCard.maestroSignOut` (distinct from the shared
`disconnect` key), used only by the Maestro card per §2.4's explicit-copy recommendation.
**Gate:** `check-i18n-parity.mjs` clean; the Maestro card visibly reads "Sign out" while the other
three still read "Disconnect".

### MSB-4 — Settings UI: filter the managed provider out of the custom-providers editor
**Files:** `frontend/src/app/pages/Settings/sections/models/CustomProvidersEditor.tsx`; additive
`managed_kind: Optional[Literal["maestro"]] = None` field on `CustomProvider`
(`backend/apps/settings/models.py`, plus the engine's `models.ts` equivalent), set only by
`apply_maestro_defaults.py`'s seeding function
**Do:** filter any `CustomProvider` with `managed_kind === "maestro"` out of the editor's rendered
list. Confirmed gap this closes: today `CustomProvidersEditor.tsx` has zero special-casing of
`MAESTRO_NAME`/`managed`, so the seeded Maestro row is editable/deletable there like any user-typed
endpoint, which becomes actively confusing once Maestro also has its own dedicated subscription
card (MSB-1).
**Gate:** with a live Maestro token, the custom-providers editor shows zero rows for it; the
picker/subscription card are unaffected (nothing is deleted from settings, only hidden from this
one editor); an old `settings.json` with no `managed_kind` key loads cleanly in both stacks and
gets the field set on the next write.

### MSB-5 — Live re-verification of the gateway's `/v1/models` contract
**Files:** none (a verification task, not a code ticket) — or, if a discrepancy is found, a
follow-up fix to `maestro_catalog.py`'s `parse_catalog()`
**Do:** once a dev machine has a valid Keycloak session again (this design's own §2.3 could not
obtain one), make a real authenticated `GET https://llm.martinstech.net/v1/models` and diff the
response against `docs/MAESTRO.md`'s 2026-08-13 table. This closes the one honestly-disclosed gap in
this design (§2.3) before or shortly after MSB-1..4 ship.
**Gate:** either confirms the documented contract still holds (update `docs/MAESTRO.md`'s date), or
surfaces a real drift for a separate bugfix ticket against `parse_catalog()`.

**Rollback for the whole set:** every ticket is additive (new array entry, new component branches,
new endpoint, new i18n keys, new optional field). Reverting any subset leaves Maestro exactly where
it is today — a working, auto-signing-in custom provider with a correctly-grouped, correctly-
dynamic model list — with zero functional loss.

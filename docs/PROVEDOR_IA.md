# provedor-ia authentication: what ships today, and the real fix

provedor-ia (`https://llm.martinstech.net/v1`) is Maestro Studio's default provider. Its bearer comes
in two shapes, and the difference decides how much of this document still matters:

- a **Keycloak access token** — a JWT with a ~10-hour lifetime and no refresh token, minted by hand:
  the user opens `https://llm.martinstech.net/login`, signs in, and the page renders the token in a
  textarea for them to copy. Everything below about expiry is about this shape.
- an **opaque static key** (`mtok_…`, no dots, so not a JWT). Verified working against the live
  gateway on 2026-08-13. It carries no `exp`, so `token_status` reads it as `opaque` and never treats
  it as dead. **Whether these are officially issued to users and how long they live is still open** —
  see "The open question" below.

## The failure this causes

Every install stops working roughly 10 hours after setup. On the gateway, each machine's traffic
turns into a stream of rejections:

```
GET  /v1/models           401 {"reason":"jwt expired"}
POST /v1/chat/completions 401 {"reason":"jwt expired"}
```

The token cannot be refreshed, because the gateway's `/login` requests `scope=openid` only — so
`offline_access` is never granted and no refresh token is ever issued. The user's only recovery is to
visit the login page again and paste a new token.

## What the app does about it (branch `prv/login-prompt`)

Mitigation, not a fix. The 10-hour expiry is still there; it is merely visible and recoverable.

- `backend/apps/settings/provedor_ia_token_status.py` decodes the token's `exp` claim locally,
  **without signature verification** — a UI decision, never an authorization one. States:
  `missing` / `expired` / `expiring` (under 30 minutes left) / `valid` / `opaque` (not a JWT, e.g. a
  static API key, and therefore never treated as dead).
- `GET /api/settings/provedor-ia/token-status` reports state plus remaining minutes, never any part
  of the token. `POST /api/settings/provedor-ia/token` stores a pasted token only if it still has
  runway; an already-expired paste is rejected with a state name and never written to settings.
- `ProvedorIaSessionGate` (mounted beside the routes in `Main.tsx`, so it runs before the first
  chat) opens a blocking-but-dismissible sign-in prompt when the token is missing or expired, and
  shows a quiet notice when under 30 minutes remain.
- A turn that dies on the gateway's 401 is classified `provedor_ia_token_expired` by
  `handle_run_error.py` / `handle_assistant_message.py`, and the existing auth cards route their CTA
  to the same sign-in prompt instead of a Settings detour.
- `guard_provedor_ia_session` refuses the turn **before the CLI spawns**, from
  `configure_provider_env`'s custom branch, when the selected model routes through provedor-ia on a
  `missing`/`expired` token. Without it the skipped 9Router node (below) leaves `cp-<slug>/<model>`
  unresolvable and the CLI blames the model: "it may not exist or you may not have access to it. Run
  `--model` to pick a different model" — a credential problem reported as a configuration one, with
  advice that cannot work. The refusal is a typed exception classified as auth by type, so it lands
  on the existing `provedor_ia_token_expired` card. It is also the only check that covers a
  **workflow or scheduled run**, which never passes the renderer's session gate at all.
- `sync_custom_providers` skips pushing a definitively-expired provedor-ia token into 9Router, so
  the app stops handing a dead bearer to the thing that keeps replaying it at the gateway. Note that
  the recurring `/v1/models` polling originates inside the **bundled 9Router process** (not in this
  repo), so this is the only lever available here.

## The real fix: loopback OAuth + PKCE with `offline_access`

The correct flow is an authorization-code grant with PKCE against a loopback redirect, storing a
refresh token and rotating it silently. **It is blocked on Keycloak configuration, not on client
work.** Verified against Keycloak directly: `provedor-ia-web` has PKCE mandatory, device-code
disabled, and **no loopback redirect URI registered** — both `http://localhost:20128/callback` and
`http://127.0.0.1:17412/callback` come back `Invalid parameter: redirect_uri`.

Three asks, all on the identity provider side:

1. **Register the loopback callbacks** on the `provedor-ia-web` client:
   `http://127.0.0.1:20128/callback` and `http://localhost:20128/callback`.
2. **Grant `offline_access`** to the client / to the users, and include it in the `/login` scope so a
   refresh token is actually issued.
3. **Raise the refresh and SSO lifespans** — SSO session idle and SSO session max, plus the refresh
   token lifespan — to the 7-to-30-day range, so a rotating refresh token survives a weekend.

## The reference implementation already exists

`src/provedoria/windows-provider.ps1` in `gmartinstech/provedor-ia` is a working implementation of
exactly that flow: loopback HTTP listener, PKCE S256 challenge, refresh-token rotation, and the
token stored in Windows Credential Manager. It is blocked by nothing except the unregistered
callback URI above. Once the three asks land, port that flow into the Electron main process and
replace the browser-and-paste half of the prompt described here; the status helper, the gate, and
the auth-error routing all stay as they are.

## Notes for whoever picks this up

- The token is a credential. `backend/apps/settings/redaction.py` and `backend/apps/swarm/redact.py`
  both already cover `provedor_ia_token`; do not weaken that. It must never be logged, never appear
  in an error message, and never be written outside the settings path.
- The 401 throttle on the gateway's public listener is 10 failed auths per minute, so a client that
  retries an expired token in a loop locks itself out on top of being broken. `refresh_catalog`
  therefore returns early on an empty token rather than probing.

## Verified against the live gateway — 2026-08-13

The earlier note that "nothing here has been verified against the live gateway" no longer holds; a
valid `mtok_…` key was used to probe it directly. What is actually there:

| Path | Result |
| --- | --- |
| `GET /v1/models` | **200** — `{"object":"list","data":[…]}`, ids only |
| `POST /v1/chat/completions` | **200** — answered on `nemotron-3-nano:30b`, `system_fingerprint: fp_ollama` |
| `GET /login` | **302** to Keycloak |
| everything else tried (~30 paths) | **404** |

- **The catalog is four models**: `maestro`, `maestro-fast`, `maestro-ultra`, `maestro-code`, all
  `owned_by: martinstech`. Rows carry `id`/`object`/`created`/`owned_by` and **no** label, context
  window, or pricing — which is why `provedor_ia_catalog.py` supplies labels and keeps 128k/4096.
- **The gateway is Ollama-backed**, and the `maestro-*` ids are masks over real models; the chat
  response names the backing model, not the mask.
- **Keycloak, straight off the `/login` redirect**: issuer
  `https://martinstech.net/auth/realms/MartinsTech`, client `provedor-ia-web`, `response_type=code`,
  `code_challenge_method=S256`, `redirect_uri=https://llm.martinstech.net/callback`, and
  **`scope=openid` only** — confirming first-hand that no refresh token is ever issued.
- **There is no billing, plan, quota, usage, or `/me` surface.** Every such path 404s. Any
  subscription UI in this app would be inventing a contract the server cannot honor, so the gateway
  has to expose one first. `gmartinssi/provedor-ia` is an **empty repo** (no code, no branches), so
  the `windows-provider.ps1` reference implementation cited above is not currently retrievable there.

## The open question: are static `mtok_` keys the supported credential?

This decides whether the loopback-OAuth epic above is worth doing at all — a long-lived static key
removes the 10-hour expiry that the epic exists to fix.

Evidence that static keys are intended, not incidental: the gateway's own installer at
`https://llm.martinstech.net/launch.ps1?pi` prompts for "your provedor-ia **API token**" and writes it
to a **permanent user environment variable** (`[Environment]::SetEnvironmentVariable(…, "User")`) with
no refresh logic and no expiry handling anywhere in the script. Nobody wires a permanent env var for a
10-hour credential.

Not yet known: their actual TTL, whether they can be minted by ordinary users (the `/login` page only
ever produced JWTs), and whether they can be revoked. Settle this with whoever runs the gateway before
investing in the Keycloak asks.

One more reason not to trust hand-kept lists: that same installer offers **three** models and is
already missing `maestro-fast`, which `/v1/models` returns. That drift is why the catalog is fetched
(`backend/apps/settings/provedor_ia_catalog.py`) and `PROVEDOR_IA_MODELS` is only the offline fallback.

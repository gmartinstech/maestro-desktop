# Maestro authentication: loopback OAuth + PKCE + credential store refresh

The Maestro provider (`https://llm.martinstech.net/v1`) is Maestro Studio's default AI model gateway. Authentication uses Keycloak with an **authorization-code flow over a loopback callback**, storing and refreshing credentials via the OS credential store — no manual token paste, no 10-hour expiry, indefinite session as long as the app is used at least once per month.

## The authentication flow

1. **Initial startup:** The app checks for a stored credential. If missing or invalid, it automatically opens the system browser (no user interaction required) to the Keycloak authorize endpoint.

2. **Loopback callback:** The user signs in via Keycloak. The authorize response is redirected to `http://127.0.0.1:20128/callback`. The bundled 9Router Node process (which owns port 20128) receives the callback and proxies it into the backend.

3. **Token exchange (PKCE S256):** The backend exchanges the authorization code for tokens using PKCE S256, which authenticates the request without requiring a client secret. **A client secret does not exist and is never sent** — the Keycloak metadata lists `clientAuthenticatorType: client-secret`, but no secret is configured on this client.

4. **Credential storage:** The backend extracts the refresh token and stores it in the OS credential store via Python `keyring` (Windows Credential Manager on Windows). The access token is not persisted.

5. **Silent background refresh:** Before token expiry, the app silently requests a new access token using the stored refresh token. The session never interrupts.

6. **30-day idle timeout:** If the app is not used for 30 days, the offline session is invalidated on the Keycloak server. The next app launch detects the invalid credential and repeats the authorize flow (step 1).

## Verified OAuth parameters

These values are exact and should not be altered:

- **Issuer:** `https://martinstech.net/auth/realms/MartinsTech`
- **Client ID:** `provedor-ia-web` — a **public client**; no client secret exists or is ever configured.
- **Redirect URIs registered:** `http://127.0.0.1:20128/callback` and `http://localhost:20128/callback`
- **Scope:** `openid offline_access` — **`offline_access` is REQUIRED** for a refresh token. Without it, you get the same ~10-hour dead end as the old flow.
- **PKCE:** S256, **mandatory** — Keycloak rejects auth requests with no `code_challenge`.
- **Direct Access Grants (Resource Owner Password Credentials):** **disabled** — authorization-code + PKCE is the only working flow.
- **Token lifetimes (server-side, read-only):** access token 12 hours; offline session idle timeout 30 days with no max-lifespan cap.

## Architectural notes

- **Port 20128 (9Router):** The bundled Node process already owned this port for other routes. A small patch proxies every `/callback` hit from Keycloak into the backend's callback handler. No new HTTP listener was added.
- **Credential revocation:** Revoking the `ai-user` Keycloak role or invalidating the user's offline session on the server is the **only** way to cut off access. There is no app-side key to separately rotate or revoke.
- **OS credential store:** Windows Credential Manager (via Python `keyring`) replaces the reference PowerShell implementation's direct Windows API calls because the backend — not Electron — is the actual token consumer. This gives the same security and lifetime as the original design.

## Implementation reference

`src/provedoria/windows-provider.ps1` in `gmartinstech/provedor-ia` is the reference implementation ported to Python:
- Loopback HTTP listener (port 20128, now part of 9Router)
- PKCE S256 challenge-response
- `offline_access` scope for refresh token
- Refresh token rotation on each exchange
- OS credential store integration (Windows Credential Manager → Python `keyring`)

## Internal storage naming (backward compatibility)

The following internal identifiers were **deliberately NOT renamed** to avoid breaking existing installs. The user-facing label "Maestro" does not apply here:

- Settings field: `provedor_ia_token` (not renamed)
- Environment variable: `PROVEDOR_IA_TOKEN` (not renamed)
- Gateway repo: `gmartinstech/provedor-ia` (not renamed)
- Gateway hostname: `llm.martinstech.net` (not renamed)
- Keycloak client ID: `provedor-ia-web` (not renamed)

Changing these would silently lose stored credentials on upgrade. If they are ever renamed in the future, a migration helper is required to read the old key and write the new one.

## Credential redaction

The credential is sensitive. Redaction covers `provedor_ia_token` in:
- `backend/apps/settings/redaction.py`
- `backend/apps/swarm/redact.py`

It must never be logged, never appear in an error message, and never be written outside the settings store.

## Verified against the live gateway — 2026-08-13

| Path | Result | Notes |
| --- | --- | --- |
| `GET /v1/models` | **200** | Returns `{"object":"list","data":[…]}`, id-only rows |
| `POST /v1/chat/completions` | **200** | Streaming completion (Ollama-backed) |
| `GET /login` | **302** to Keycloak | Redirects to the authorize endpoint |
| All other paths (~30 tried) | **404** | No billing, quotas, user profile, or subscription surface |

**Catalog:** Four models available: `maestro`, `maestro-fast`, `maestro-ultra`, `maestro-code`, all `owned_by: martinstech`. The app's `maestro_catalog.py` supplies user-facing labels and context windows (128k/4096) because the gateway's catalog rows carry only `id`/`object`/`created`/`owned_by`.

**Gateway backend:** Ollama. The `maestro-*` model ids are masks; the chat response names the actual backing model, not the mask.

## Static opaque keys (`mtok_…`) — still supported, status unresolved

Before the OAuth flow, users could provision long-lived static API keys (`mtok_…` format, no dots). These carry no `exp` claim and are read as `opaque` by the token-status decoder — never treated as dead.

**Evidence these may be intended:**
- The gateway's own installer at `https://llm.martinstech.net/launch.ps1?pi` prompts for "your provedor-ia **API token**" and stores it in a **permanent user environment variable** (no refresh logic, no expiry handling) — a setup pattern typical of static credentials, not 10-hour access tokens.
- The app's token-status decoder explicitly handles `opaque` tokens and does not expire them.

**Open questions:**
- Whether these keys are officially issued to ordinary users (the `/login` page only produced JWTs).
- Their actual TTL.
- Whether they can be revoked, and how.
- Their long-term supported status now that OAuth is the primary flow.

This is a genuinely separate credential type whose long-term status remains unresolved. The OAuth work does not affect it — both flows are supported in parallel. Settle the static key questions with whoever runs the gateway before investing further.

## Historical context (what changed and why)

Before this flow, users manually copied a Keycloak JWT (10-hour lifetime, no refresh) from a browser page and pasted it into the app's Settings. Every ~10 hours, the app stopped working, requiring the user to repeat the paste. The mitigation in this doc's previous version (visible token-status detection + auth error routing) made the failure visible but not fixed.

The loopback OAuth + PKCE + credential store flow fixes the root cause: refresh tokens are fetched once and stored, rotated silently, and the session never expires within normal use. Manual token paste is gone; the authorize flow is triggered automatically on startup if needed.

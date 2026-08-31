# Deterministic Packaged E2E Design

## Status

Proposed and approved for design. Implementation awaits review of this document.

## Problem

The packaged Electron E2E suite has valuable coverage but its generic launch path was historically coupled to the developer or CI profile. Its large serial `combinatorial-flows` journey assumes an existing dashboard, English UI labels, an already-ready backend authorization token, and shared state from earlier tests.

A clean profile exposed the consequences:

- translated labels make English-only selectors fail;
- Electron reads `auth.token` and `backend.log` from the host profile instead of `MAESTRO_DATA_ROOT`, so an isolated renderer can receive the wrong per-install bearer and return 401;
- an unsuccessful create response is consumed as a dashboard object and produces `/dashboard/undefined`;
- a closed Electron process can leave its bundled 9Router child alive and lock the next package build;
- crash accounting reads the real profile's log rather than the launched test profile's log.

The suite must test the packaged app without relying on cloud credentials, a preexisting user profile, or execution order.

## Considered Approaches

### 1. Adapt the existing monolithic journey

Add more `data-testid` selectors, suppress expected startup 401s, and keep the shared serial app.

This is the smallest diff, but it preserves hidden state dependencies and turns an authorization regression into accepted noise. It is rejected.

### 2. Replace all E2E tests

Discard the existing suite and write new Playwright specs from scratch.

This would lose useful packaged-app, renderer-crash, settings, and dashboard coverage while creating a large review surface. It is rejected.

### 3. Targeted harness rewrite and scenario split (chosen)

Keep the useful assertions and packaged-binary coverage, but replace the generic launch contract, make boot authorization explicit, and split the stateful journey into isolated scenario specs. Preserve dedicated golden and real-provider paths.

## Scope

### Generic deterministic fixture

Introduce one fixture used by ordinary packaged E2E specs. It will:

1. Create a unique `MAESTRO_DATA_ROOT`, `MAESTRO_STATE_HOME`, and Electron `--user-data-dir` for each test.
2. Seed only local, non-secret test settings required to dismiss the local sign-in gate, including the fixed opaque `mtok_e2e_fake_opaque_token`. It must not copy provider keys or a Maestro bearer from the parent process.
3. Launch the packaged binary with `MAESTRO_MOCK_AGENT=1`, disabled preflight, and a test-only English locale flag.
4. Return the app, renderer page, roots, and an authenticated local API helper.
5. Close the app and verify that only children belonging to that launch are reaped. It must not kill unrelated developer processes.
6. Remove the disposable roots after teardown, retaining artifacts only on failure when Playwright needs them.

The fixture is test infrastructure, not a production bypass: protected backend endpoints remain protected.

### Startup authorization contract

Electron must resolve `auth.token` and `backend.log` from the same `MAESTRO_DATA_ROOT` as the backend. The application must not mount routes that issue protected API requests until that preload-backed per-install token is available. The existing fetch interceptor remains a defense-in-depth mechanism, but it is not the boot-readiness contract.

Add a focused regression test that launches a clean packaged profile and proves:

- the token bridge returns a nonempty token;
- a protected local API request succeeds with that token;
- first dashboard discovery/creation does not emit a 401 or produce an undefined route.

If a bounded retry is needed for backend restart after boot, it must be explicit, single-attempt, and tested separately. Generic E2E must never whitelist authorization failures.

### Deterministic state and locale

The fixture will create required dashboard state through the authenticated local API and return its ID. Individual specs must not depend on DashboardSelection's first-run auto-create behavior.

A dedicated clean-profile dashboard-selection test will cover that first-run behavior directly.

Generic interaction specs run in explicit English so semantic roles and accessible names remain the primary locator strategy. Stable `data-testid` attributes remain appropriate for icon-only controls and controls without a reliable accessible identity. A small pt-BR smoke verifies that the selected locale is actually applied; it does not duplicate every interaction flow.

### Scenario layout

Replace the serial 12-step combinatorial test with independent specs or describes using a fresh fixture:

- `boot-auth`: clean launch, token readiness, localized boot, protected API access;
- `dashboard`: create, switch, and return to a dashboard;
- `settings`: modal lifecycle, tabs, theme save/revert, and selected toggles;
- `toolbar`: note/app/history surfaces and mock-agent composition where the platform supports it;
- `resilience`: a deliberately short repeated modal/route cycle with renderer and console assertions.

A single short user-journey smoke may retain one representative path. It must create its own state and cannot rely on another test's mutations.

Heavy webview and real-provider tests remain separately gated. `real-agent-roundtrip` retains isolated roots and only runs when an explicitly supplied provider key is present. Golden remains the packaging and deterministic mocked-agent smoke; later fixture reuse is optional and outside this change.

### Diagnostics and failure handling

Visibility, backend-log, crash, and screenshot helpers receive the fixture's roots rather than deriving paths from the host profile. Expected operational warnings are narrowly documented. 401s, undefined IDs/routes, renderer crashes, and unhandled console errors remain failures.

## Non-goals

- Do not weaken backend authorization or add a production unauthenticated E2E endpoint.
- Do not call a real provider or cloud service from normal CI E2E.
- Do not replace all accessibility-based locators with test IDs.
- Do not redesign product dashboard, settings, or authentication UX solely for test convenience.

## Acceptance Criteria

1. Normal packaged E2E runs with no developer profile, provider credential, or cloud dependency.
2. Each ordinary scenario is independently runnable and passes from an empty disposable profile.
3. The clean-launch authorization regression is covered and cannot be silenced by a console whitelist.
4. A failed or completed run does not leave a bundled backend or 9Router process that blocks a subsequent package build.
5. Existing golden smoke and opt-in real-provider coverage retain their separate behavior.
6. `npm run verify` passes on the integration branch after the final implementation.

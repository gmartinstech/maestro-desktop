# Open PR Reconciliation Design

## Goal

Bring the intended work from open PRs #5, #12, and #14 to `main` without regressing the current Maestro-only networking or CDN release path.

## Scope and boundaries

- Integrate the DET intent of PR #5 only where current `main` does not already provide it. Current CDN publishing (`scripts/build-app-win.ps1 -Publish` to cloudinha) is authoritative and must not be replaced by PR #5's historical GitHub-release behavior.
- Add PR #12's standalone `design-system/` and `.design-sync/` assets without coupling them to the Electron frontend in this change.
- Reconcile all PR #14 changes: the installer-path repair, E2E test repairs, CI scheduling changes, and structural-lint refactor. Where its refactor overlaps later `main` work, resolve the overlap using the current behavior while retaining the PR's structural decomposition and test intent.
- Do not merge the old PR branches directly. Their merge bases are stale, and PR #5 has conflicts with current `main`.
- Do not alter or remove existing worktrees.

## Integration architecture

An isolated `integrate/open-prs-main` branch starts at current `main`. Each PR is inspected as a set of independent commits and paths, then reapplied as small, purpose-specific commits:

1. DET reconciliation: compare PR #5 against current `main`; preserve only absent detachment behavior and tests. Prefer current CDN updater, release runbook, and Maestro provider configuration whenever the versions disagree.
2. Design-system import: apply PR #12's additive standalone files. Add narrow linter exclusions only for generated/sync material if the repository's structural linter cannot sensibly validate those external-format assets; do not loosen limits for application source.
3. CI/E2E and structural reconciliation: apply PR #14's installer fix, repaired/deleted tests, CI scheduling changes, and structural decomposition. Keep PR checks fast but retain an explicit required PR gate that exercises changed code; full packaging stays required on `main` and manually dispatchable.

After each stage, run focused checks. Run the full `npm run verify` only after all three stages are combined. A separate review of the final diff is required before merging the integration branch to `main`.

## CI policy

The pipeline must distinguish between fast PR feedback and release assurance:

- PRs run lint, hermetic tests, secret scanning, and a deterministic packaged-app gate.
- Expensive end-to-end, installer, and full verification jobs run on push to `main` and may be dispatched manually.
- Skipping expensive PR jobs must not mark an untested branch as verified; required PR status checks remain limited to the fast gates.
- The structural linter remains enforced for owned application code. Add exclusions only for PR #12's externally consumed design-sync source if inspection proves it is isolated and non-shipping.

## Error handling and rollback

Each imported intent is a separate commit. If focused verification fails, revert only the stage that introduced the failure and investigate before continuing. The final integration branch is never force-pushed. If the final PR fails its `main` checks, do not merge or publish a new CDN build.

## Verification and acceptance criteria

- `scripts/check-callhome.mjs` remains clean after DET reconciliation.
- The current CDN publisher and `electron/cdnUpdater.js` behavior remain intact.
- PR #12 assets validate through their own package scripts and do not become runtime dependencies of `frontend/`.
- Repaired E2E tests target current UI behavior; obsolete onboarding tests are removed only after replacement coverage exists where appropriate.
- CI workflow syntax and trigger conditions are tested locally where possible.
- `npm run verify` passes on the combined branch.
- The final integration branch has a clean working tree and a reviewable PR against current `main`.

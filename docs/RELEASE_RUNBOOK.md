# Release Runbook

How an OpenSwarm desktop release is built, verified, and promoted. The guiding
rule: **a release is reproducible and provenanced** — anyone can tell exactly
what commit produced a given DMG/EXE, and rebuilding that commit yields the same
bits. Distribution stays on GitHub Releases (auto-updater feeds live there).

## Versioning

Source of truth is `electron/package.json` `version`. Bump it only when cutting
a release (see CONTRIBUTING.md for semver rules). A `-` suffix (e.g.
`1.2.0-beta.1`) marks an experimental/pre-release build; the Windows CI and the
build scripts set the pre-release channel automatically from that suffix.

## What is pinned (reproducibility)

| Thing | Pin | Where |
|-------|-----|-------|
| uv | `0.11.16` | `scripts/build-app.sh`, `scripts/build-app-win.ps1` (override `UV_VERSION`) |
| Node (bundled runtime + CI toolchain) | `20.18.1` | build scripts, `.nvmrc`, `.github/workflows/*` |
| 9router | `0.3.60` | `scripts/fetch-router.{sh,ps1}` (override `ROUTER_VERSION`) |
| Python | `3.13.2` standalone | `scripts/build-python-env*.{sh,ps1}` |
| Python deps | fully hash-locked | `backend/requirements.lock` |
| npm deps | lockfile-exact via `npm ci` | `frontend/package-lock.json`, `electron/package-lock.json` |
| electron-builder + deps | exact (no `^`) | `electron/package.json` |

Both `package-lock.json` files are **committed** — `npm ci` refuses to run
without them. Do not re-add them to `.gitignore`.

### Regenerating the Python lock

After editing `backend/requirements.txt`:

```
uv pip compile backend/requirements.txt --python-version 3.13 \
    --generate-hashes --output-file backend/requirements.lock
```

Commit both files together. Verify with a clean 3.13 env: install from the lock,
`uv pip check`, and import anthropic / pydantic / httpx / trafilatura /
claude_agent_sdk / uvicorn.

## Provenance

Every build writes `electron/build-info.json` (gitignored, regenerated) with the
`git rev-parse HEAD` sha, build time, channel, and version. It ships in the asar
and surfaces in two places:

- Startup log line in `backend.log`: `[provenance] OpenSwarm <ver> sha=<short> channel=<...>`
- Settings → General → Advanced → About → **Build**

To confirm an artifact's provenance: launch it, open Settings, and compare the
Build sha to `git rev-parse HEAD` of the tag you released.

## Build (local)

- macOS: `bash scripts/build-app.sh` (unsigned) / `--sign` / `--publish`.
  Needs `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for signing.
- Windows: `pwsh scripts/build-app-win.ps1` (unsigned) / `-Sign` / `-Publish`.
  Signing is Azure Trusted Signing; CI handles it (see below).

## Release (CI)

Pushing a `v*` tag triggers `.github/workflows/release-windows.yml`, which builds
+ signs the Windows installer and uploads it to the GitHub Release for that tag.
macOS currently publishes from a Mac via `bash publish.sh`.

Recommended order so neither platform's users skip a version:
1. macOS: `bash publish.sh` (produces `latest-mac.yml`).
2. Windows: push the `v*` tag (or `pwsh publish-win.ps1`), producing `latest.yml`.
3. Verify both `latest.yml` and `latest-mac.yml` exist on the release and their
   versions match before the release leaves draft.

## Tag protection (immutable releases)

Release tags must never move once cut — a moved tag silently re-points the
auto-updater feed at different bits. Configure a GitHub **ruleset** to enforce
this (Settings → Rules → Rulesets → New ruleset):

1. Target: **Tags**, pattern `v*`.
2. Enable **Restrict creations** off, **Restrict updates** on, **Restrict
   deletions** on. (Equivalently: block non-fast-forward / force-push and
   deletion on the `refs/tags/v*` ref.)
3. Apply to all users (no bypass list, or restrict bypass to break-glass only).

Verify: push a throwaway tag, then `git push --force origin <tag>` to move it →
GitHub must reject it. Delete the throwaway afterward (allowed only if you
temporarily exempt it, or use a non-`v*` name for the test).

GitHub releases are also independently markable immutable; tag protection is the
load-bearing control because the auto-updater resolves the tag, not the release.

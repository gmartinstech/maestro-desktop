# Release Checklist

Copy this into the release PR/issue and tick every box before promoting a draft
release to `latest`. The goal: no broken build ever reaches users. Windows is the
only shipped target — macOS was dropped and its build/release pipeline deleted.
See `RELEASE_RUNBOOK.md` for the how; this is the gate.

## Pre-build
- [ ] `dev` is green and dogfooded; the release commit is chosen.
- [ ] `electron/package.json` `version` bumped per semver (CONTRIBUTING.md).
- [ ] `backend/requirements.lock` regenerated if `requirements.txt` changed, and
      committed alongside it.
- [ ] Both `package-lock.json` files committed (frontend + electron).

## Build
- [ ] Windows EXE built from the release commit (push `v*` tag → CI, or
      `pwsh publish-win.ps1`), signed.
- [ ] Provenance matches: launch the artifact, Settings → About → **Build** sha
      equals `git rev-parse HEAD` of the release commit.

## Artifacts + feeds (promotion gate)
- [ ] GitHub draft release for `v<version>` has: `MaestroStudio-Setup-x64.exe`
      and `latest.yml`.
- [ ] Promotion gate passes:
      `node scripts/release/verify-release.js --dir <downloaded-feeds> --expect-version <version> --base-url https://github.com/gmartinstech/maestro-desktop/releases/download/v<version>`
      (`latest.yml` present, version agrees with package.json and the tag,
      every asset HEAD-resolves to 200).

## Dogfood on real target OSes (in production, signed)
- [ ] Windows 11 x64: fresh install of the signed EXE, no SmartScreen block after
      signing, app boots, backend reaches ready, send one agent message (gets a
      response). Check `backend.log` `[provenance]` + `[perf]` lines.
- [ ] Windows 10 x64: same.
- [ ] Auto-update: previous stable installed → this release detected, downloads,
      installs on quit, relaunches on the new version.
- [ ] Widevine DRM: in a Browser card open a Spotify playlist (or any DRM title)
      and confirm a track plays PAST the ~10s encrypted boundary and auto-advances,
      with no `[drm-diag] License response 500` in the logs. A signed-but-not-VMP
      build boots fine and only fails here, so this box catches it.

## Promote
- [ ] All boxes above ticked.
- [ ] Remove the draft flag (publish the release) — this is the only manual
      promote step; nothing auto-promotes.
- [ ] Confirm `latest.yml` is live (HEAD 200) post-publish.

## Rollback (if a regression surfaces post-promote)
- [ ] Re-publish the previous release's feeds as latest, or cut a patch.
- [ ] Tags are immutable (ruleset) — never move `v<version>`; ship a new version.

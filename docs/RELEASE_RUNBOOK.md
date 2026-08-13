# Release Runbook

How a Maestro Studio desktop release is built, verified, and promoted. The guiding
rule: **a release is reproducible and provenanced** — anyone can tell exactly
what commit produced a given EXE, and rebuilding that commit yields the same
bits. Distribution is self-hosted: `cdn.martinstech.net/maestro/*`, served from
the `cloudinha` VPS (see `docs/superpowers/specs/2026-08-13-cdn-version-management-design.md`
for the full design).

## Versioning

Version is always `1.{git rev-list --count HEAD}` (e.g. `1.482`) — computed fresh
at build time by `scripts/build-app-win.ps1`, never stored or committed anywhere.
There is nothing to bump: the commit count only grows, so two branches can never
disagree on a version number. `electron/package.json`'s own `version` field is
just a placeholder overridden per-build via electron-builder's `extraMetadata`.

## What is pinned (reproducibility)

| Thing | Pin | Where |
|-------|-----|-------|
| uv | `0.11.16` | `scripts/build-app-win.ps1` (override `UV_VERSION`) |
| Node (bundled runtime + CI toolchain) | `20.18.1` | build scripts, `.nvmrc`, `.github/workflows/*` |
| 9router | `0.3.60` | `scripts/fetch-router.{sh,ps1}` (override `ROUTER_VERSION`) |
| Python | `3.13.2` standalone | `scripts/build-python-env-win.ps1` |
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
`git rev-parse HEAD` sha, build time, channel, and the git-commit-count version.
It ships in the asar and surfaces in two places:

- Startup log line in `backend.log`: `[provenance] Maestro <ver> sha=<short> channel=<...>`
- Settings → General → Advanced → About → **Build**

To confirm an artifact's provenance: launch it, open Settings, and compare the
Build sha to `git rev-parse HEAD` of the commit you released, and the version to
`git rev-list --count HEAD` of that same commit (as `1.<count>`).

## Build (local)

Windows is the only shipped target. macOS was dropped and its build/release
pipeline (`scripts/build-app.sh`, `publish.sh`, `release-macos.yml`, notarization,
entitlements) was deleted — do not resurrect it without a decision to re-adopt it.

- `pwsh scripts/build-app-win.ps1` — local dev build, unsigned.
- `pwsh scripts/build-app-win.ps1 -Sign` — signed build (Azure Trusted Signing), not published.
- `pwsh scripts/build-app-win.ps1 -Publish` — signed build, then scp's the installer to
  `cloudinha:~/maestro-releases/incoming/` and prints the version + sha256 to paste into the
  cloudinha publish step below.

## Release (manual, two machines)

1. On your build machine: `pwsh scripts/build-app-win.ps1 -Publish`. Note the printed version
   and sha256.
2. On `cloudinha` (the box `cdn.martinstech.net` resolves to): paste the cloudinha publish
   prompt (kept outside this repo — ask whoever ran the CDN setup for it) with that version and
   sha256 filled in. It moves the installer into the CDN webroot, rewrites `version.json`, and
   prunes anything past the 3 most recently published builds.
3. Confirm: `curl -sI https://cdn.martinstech.net/maestro/version.json` returns 200, and its
   `latest.version` matches what you just published.

## Update verification (before telling anyone it's live)

Windows apps check `cdn.martinstech.net/maestro/version.json` on launch and every 4h, download
in the background on detect, and install on quit (or after a sustained idle period with no
active agent). To verify a release actually lands:

1. Install the previous stable build.
2. Launch it, wait for (or trigger via Settings → Check for Updates) the update-available /
   update-downloaded flow.
3. Restart & Update (or quit and relaunch) — confirm it comes back up on the new version
   (Settings → About → Build sha flips to the new commit).

**No staged rollout.** Unlike the old GitHub-Releases flow, a published version is immediately
live for every Windows install that checks — there is no `stagingPercentage` gate and no
automated feed-integrity check before it goes out. This is a deliberate simplification (see the
CDN design spec's "accepted tradeoff"); if the install base grows enough that a bad build reaching
everyone at once becomes a real risk, re-introduce staged rollout in `version.json` (a stable
per-install hash bucketed against a percentage field) rather than reverting to GitHub Releases.

## Rolling back a bad release

Re-run the cloudinha publish step against an older build still in
`~/maestro-releases/incoming/` (or re-scp it there) with a version number attribute matching
what you want `version.json`'s `latest` to point to. There's no dedicated rollback tooling
beyond "publish an older build again" — the update check only compares against whatever
`version.json` currently says is latest.

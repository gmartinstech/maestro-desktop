# Release Runbook

How a Maestro Studio desktop release is built, verified, and promoted. The guiding
rule: **a release is reproducible and provenanced** — anyone can tell exactly
what commit produced a given EXE, and rebuilding that commit yields the same
bits. Direct-download distribution is self-hosted at `cdn.martinstech.net/maestro/*`,
served from the `cloudinha` VPS (see
`docs/superpowers/specs/2026-08-13-cdn-version-management-design.md` for the full
design). Microsoft Store distribution is a separate AppX submission channel with
Store-managed installation and updates.

## Versioning

Version is `1.{N}.0` (e.g. `1.482.0`) where `N` is normally
`git rev-list --count HEAD` — computed fresh at build time by
`scripts/build-app-win.ps1`, never stored or committed anywhere. There is
nothing to bump.

**The commit count is floored against what is already published.** It is not
monotonic on its own: squash-merging a long-lived branch collapses its commits
into one on `main`, so the count can go *down*. That happened — PR #8 was
squash-merged, leaving `main` at 1747 while the CDN was already serving
`1.1756.0`. A version that goes backwards is not cosmetic:

- Squirrel **refuses to install** an older version over a newer one. It leaves an
  empty `app-<version>\.dead` marker and keeps running the installed build, so
  the installer appears to succeed while nothing changes.
- No install already on the higher version will ever update, since the update
  check only moves forward.

So the build reads `latest.commitCount` from the published `version.json` and uses
`max(commit count, published + 1)`. If the CDN is unreachable the build warns and
proceeds unfloored (fine for local/dev builds); set `MAESTRO_VERSION_FLOOR`
explicitly to skip the lookup or to force a value. **Prefer a merge commit or
rebase over a squash-merge** for release-bearing PRs so the count stays monotonic
on its own and the floor stays a backstop rather than the mechanism.

`electron/package.json`'s own
`version` field is just a placeholder overridden per-build via
electron-builder's `extraMetadata`. The trailing `.0` isn't cosmetic — NuGet/
Squirrel needs three dotted segments, and electron-builder's `${version}`
artifactName token and `app.getVersion()` both resolve to this exact string,
so it's the one version format used everywhere (filename, manifest, About
screen).

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
uv pip compile backend/requirements.txt --python-version 3.13 --universal \
    --generate-hashes --output-file backend/requirements.lock
```

`--universal` is not optional. Without it the resolve is platform-specific: it
strips the `sys_platform` markers the rest of the lock carries and silently drops
packages that do not apply to the machine you ran it on (compiling on Windows
removes `uvloop`). Diff the result before committing — a correct regeneration is
purely additive.

Commit both files together. Verify with a clean 3.13 env: install from the lock,
`uv pip check`, and import anthropic / pydantic / httpx / trafilatura /
claude_agent_sdk / uvicorn.

The build only reinstalls `electron\python-env` when this lock's SHA256 differs
from the marker written at `electron\python-env\.requirements-hash`. A dependency
added to `requirements.txt` but never compiled into the lock is therefore absent
from the packaged app, whose backend then dies on import and never serves — which
presents as the app booting to a blank window, not as a build failure.

## Provenance

Every build writes `electron/build-info.json` (gitignored, regenerated) with the
`git rev-parse HEAD` sha, build time, channel, and the git-commit-count version.
It ships in the asar and surfaces in two places:

- Startup log line in `backend.log`: `[provenance] Maestro <ver> sha=<short> channel=<...>`
- Settings → General → Advanced → About → **Build**

To confirm an artifact's provenance: launch it, open Settings, and compare the
Build sha to `git rev-parse HEAD` of the commit you released, and the version to
`git rev-list --count HEAD` of that same commit (as `1.<count>.0`).

## Build (local)

Windows is the only shipped target. macOS was dropped and its build/release
pipeline (`scripts/build-app.sh`, `publish.sh`, `release-macos.yml`, notarization,
entitlements) was deleted — do not resurrect it without a decision to re-adopt it.

- `pwsh scripts/build-app-win.ps1` — local dev build, unsigned.
- `pwsh scripts/build-app-win.ps1 -Store` — Azure-free, build-only AppX artifact; requires the
  non-secret Partner Center identity values in `.env.windows`. Publish an existing Store artifact
  separately with `pwsh scripts/publish-store-appx.ps1 -ArtifactPath <path>`.
- `pwsh scripts/build-app-win.ps1 -Sign` — Azure Trusted Signing build for direct delivery, not published.
- `pwsh scripts/build-app-win.ps1 -Publish` — Azure Trusted Signing build for direct CDN/Squirrel
  delivery, then scp's the installer to `cloudinha:~/maestro-releases/incoming/` and prints the
  version + sha256 to paste into the cloudinha publish step below.

## Microsoft Store release and static AppX download

1. Reserve the Maestro Studio identity in Partner Center and copy its **Identity name**,
   **Publisher**, and **Publisher display name** into the ignored `.env.windows` file as
   `MAESTRO_STORE_IDENTITY_NAME`, `MAESTRO_STORE_PUBLISHER`, and
   `MAESTRO_STORE_PUBLISHER_DISPLAY_NAME`. These are non-secret identity values; do not commit
   the file.
2. Check out the exact approved `main` commit and run `pwsh scripts/build-app-win.ps1 -Store`.
   It does not need Azure credentials and emits a build-only AppX.
3. Publish the exact artifact without rebuilding it:
   `pwsh scripts/publish-store-appx.ps1 -ArtifactPath electron/dist/MaestroStudio-Store-<version>-x64.appx`.
   The publisher validates the packaged identity, Store provenance, SHA-256, and public OAuth URL,
   then atomically publishes the AppX and its JSON sidecar under
   `https://cdn.martinstech.net/maestro/downloads/`.
4. Fetch both public files and compare the downloaded AppX SHA-256 to the publisher output. The
   sidecar must report `channel: store-static-download`, the version, SHA-256, and provenance SHA.
   Upload those same verified AppX bytes manually in Partner Center and complete submission.
5. After certification, install through Microsoft Store. Settings → General → Advanced → About
   must show the released source SHA and `store` channel. Software update must say Microsoft
   Store manages updates, and its action must open Microsoft Store rather than downloading a CDN
   installer.
6. Static Store AppX hosting never authorizes an unsigned CDN/Squirrel release. The existing
   `-Publish` command remains only for direct CDN/Squirrel delivery and requires Azure Trusted
   Signing. Never put an AppX in `version.json`, and never upload an unsigned or self-signed
   installer to the Squirrel release path.

## CDN/Squirrel release (manual, two machines)

1. On your build machine: `pwsh scripts/build-app-win.ps1 -Publish`. Note the printed version
   and sha256.
2. On `cloudinha` (the box `cdn.martinstech.net` resolves to): paste the cloudinha publish
   prompt (kept outside this repo — ask whoever ran the CDN setup for it) with that version and
   sha256 filled in. It moves the installer into the CDN webroot, rewrites `version.json`, and
   prunes anything past the 3 most recently published builds.
3. Confirm: `curl -sI https://cdn.martinstech.net/maestro/version.json` returns 200, and its
   `latest.version` matches what you just published.

## Update verification (before telling anyone it's live)

Direct CDN/Squirrel Windows apps check `cdn.martinstech.net/maestro/version.json` on launch and
every 4h, download in the background on detect, and install on quit (or after a sustained idle
period with no active agent). Microsoft Store packages do not check this manifest; Microsoft
Store owns their update cadence. To verify a CDN release actually lands:

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

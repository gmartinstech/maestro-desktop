# CDN-based version management & auto-update — design

## Problem

Maestro Studio currently checks for updates via GitHub Releases (Squirrel's
built-in `autoUpdater` on Windows, `electron-updater` on Mac). This design
replaces the Windows update path with a self-hosted alternative: version
numbers derived straight from git history, and update delivery from
`cdn.martinstech.net/maestro/*` on the `cloudinha` VPS. Mac is untouched —
it keeps its existing GitHub-releases + `electron-updater` path.

## 1. Versioning scheme

Version = `1.{git rev-list --count HEAD}.0`, e.g. `1.482.0`.

- Computed **only at build time**, never stored or committed.
- `electron-builder`'s `extraMetadata` overrides `electron/package.json`'s
  tracked `version` field for that one build:

  ```
  electron-builder --win --x64 --config.extraMetadata.version=1.482.0
  ```

- The trailing `.0` is not decorative: Squirrel/NuGet requires three dotted
  segments internally, and electron-builder's `${version}` artifactName
  token and Electron's `app.getVersion()` both resolve to this exact
  string. Rather than truncate it for display and risk the two forms
  drifting apart, `1.482.0` is the one version string used everywhere —
  filename, manifest, About screen, update prompts, `cdnUpdater.js`'s
  parsing. (An earlier draft of this design used a truncated `1.482`
  display form; a live build caught electron-builder ignoring that and
  always resolving the full three-part string, so the design was
  corrected to match reality instead.)
- Monotonic and conflict-free by construction: commit count only grows,
  and no tracked file ever holds a version number that two branches could
  disagree on.

## 2. Build artifact naming

`electron/package.json` → `build.win.artifactName` changes from
`MaestroStudio-Setup-${arch}.${ext}` to
`MaestroStudio-Setup-${version}-${arch}.${ext}`, producing e.g.
`MaestroStudio-Setup-1.482.0-x64.exe`.

## 3. Release flow (local machine)

New script `release:win` in `electron/package.json`:

1. Compute `count = git rev-list --count HEAD`, `version = 1.${count}`.
2. Run `electron-builder --win --x64 --config.extraMetadata.version=${version}.0`.
3. Compute sha256 of the produced exe.
4. `scp` the exe to `cloudinha:~/maestro-releases/incoming/`.
5. Print a ready-to-paste block: version, filename, sha256, timestamp —
   for the cloudinha-side step below.

This is a **manual, deliberate step**, run only when shipping a release.
A plain `git push` never triggers a build or publish.

## 4. CDN layout (on cloudinha, served as cdn.martinstech.net/maestro/)

```
cdn.martinstech.net/maestro/
  version.json
  MaestroStudio-Setup-1.482.0-x64.exe   ← newest
  MaestroStudio-Setup-1.479.0-x64.exe
  MaestroStudio-Setup-1.475.0-x64.exe   ← oldest kept
```

Only the 3 most recent builds are retained; anything older is deleted
(file + manifest entry) whenever a new build is published.

`version.json`:

```json
{
  "latest": {
    "version": "1.482.0",
    "commitCount": 482,
    "file": "MaestroStudio-Setup-1.482.0-x64.exe",
    "url": "https://cdn.martinstech.net/maestro/MaestroStudio-Setup-1.482.0-x64.exe",
    "sha256": "…",
    "releasedAt": "2026-08-13T18:00:00Z"
  },
  "history": ["1.482.0", "1.479.0", "1.475.0"]
}
```

## 5. Cloudinha-side publish step

After `release:win` scp's the exe to `~/maestro-releases/incoming/`, the
operator pastes a prepared prompt into a Claude Code session running on
cloudinha. That prompt (drafted separately, not part of this repo) tells
the agent to:

- verify the incoming exe's sha256 against the value the local script
  printed,
- move it into the CDN webroot,
- rewrite `version.json`'s `latest` and `history`,
- delete whatever build/version.json entry falls out of the 3-build
  retention window,
- fix file permissions/ownership in the webroot.

## 6. App-side update check & install (Windows only)

Replaces the Squirrel-feed / `electron.autoUpdater` wiring in
`electron/main.js` for Windows. Mac's `electron-updater` path is
untouched.

- Remove `setFeedURL`, `checkForUpdates`, and the GitHub-releases feed
  URL for the Windows (`isSquirrelUpdater`) branch of `setupAutoUpdater()`.
- Add a custom check: `fetch('https://cdn.martinstech.net/maestro/version.json')`,
  compare `latest.commitCount` against the running app's own version
  (read via `app.getVersion()`, itself baked in at build time per §1).
- On a newer version: emit the same `update-available` IPC event the
  renderer already listens for — no renderer/UI changes needed.
- On user approval (existing "Restart & Update" action): download the
  exe from `latest.url` to a temp path, verify its sha256 against
  `latest.sha256`, spawn it detached (Squirrel's `Setup.exe` installs
  unattended with no args, same as it does today when GitHub delivers
  it), then quit the app.
- Keep the existing periodic re-check interval and idle-install logic in
  `main.js` — only the feed source and the install trigger change, not
  the surrounding scheduling/safety logic (busy-agent guard, crash
  watchdog lock, etc.).

## Out of scope

- Mac auto-update path (stays on GitHub releases + `electron-updater`).
- Automatic build-on-push (release building/publishing stays manual).
- Delta/differential updates — every release ships a full installer.

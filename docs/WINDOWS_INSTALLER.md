# Building an installable Maestro Studio for Windows

Three signing modes, in increasing order of trust.

| Mode | Command | Trust | Use for |
|---|---|---|---|
| Unsigned | `pwsh scripts/build-app-win.ps1` | none — SmartScreen blocks | quick local smoke test |
| Dev-signed | `pwsh scripts/build-app-win.ps1 -DevSign` | only where the cert is in Trusted Root | installing on our own machines |
| Release | `pwsh scripts/build-app-win.ps1 -Sign` | full Authenticode | anything a user touches |

## Dev-signed build (what you want for internal installs)

```powershell
# 1. Make a self-signed code-signing cert, and trust it on this machine.
#    -Trust needs an elevated shell; without it the signature is present but untrusted.
pwsh scripts/make-dev-signing-cert.ps1 -Password '<choose-one>' -Trust

# 2. Point the build at it.
$env:WINDOWS_DEV_PFX = (Resolve-Path 'build/dev-signing.pfx').Path
$env:WINDOWS_DEV_PFX_PASSWORD = '<same-password>'

# 3. Build.
pwsh scripts/build-app-win.ps1 -DevSign
```

The installer lands in `electron/dist/` as `MaestroStudio-Setup-x64.exe`.

**What dev-signing does and does not buy you.** It produces a real Authenticode signature, so on any machine where the certificate is in Trusted Root the installer runs without an unknown-publisher warning. On every *other* machine it is no better than unsigned — SmartScreen will still warn, because a self-signed certificate chains to nothing. Never hand a dev-signed build to someone outside the team. `.pfx` files are gitignored; do not commit one.

`-DevSign` deliberately does not set `VMP_REQUIRE_SIGN`. Widevine VMP signing needs castlabs EVS credentials, and requiring it would block every internal build. A dev-signed build therefore has **no valid VMP signature, so DRM playback (Spotify, Netflix) in browser cards will be silent.** That is expected; only release builds get working DRM.

## Release build

Needs Azure Trusted Signing credentials in `.env.windows` (gitignored):

```
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_SIGNING_ENDPOINT=https://eus.codesigning.azure.net
AZURE_SIGNING_ACCOUNT=...
AZURE_SIGNING_CERT_PROFILE=...
GH_TOKEN=...            # only for -Publish
```

The signing hook is `electron/build/sign-windows.js`; it also needs `signtool.exe` on PATH (Windows SDK) and the `Microsoft.Trusted.Signing.Client` NuGet package for `Azure.CodeSigning.Dlib.dll`.

## App identity — change these together or not at all

`productName` in `electron/package.json` and the app-support folder name in `backend/config/paths.py` **must stay in sync**. Electron derives `app.getPath('userData')` from `productName`, and `electron/main.js:143` reads the *backend's* `settings.json` through that path. If the two names diverge, the app and the backend read and write different directories and the app appears to lose its settings.

Current identity:

| Field | Value |
|---|---|
| `productName` | Maestro Studio |
| `appId` | net.martinstech.maestro.studio |
| data dir | `%APPDATA%\Maestro Studio\data` |
| installer | `MaestroStudio-Setup-x64.exe` |
| update feed | `gmartinstech/maestro-desktop` |

**Renaming from OpenSwarm relocated the data directory.** Anyone with an existing OpenSwarm install will find the app looks factory-reset, because their data is still at `%APPDATA%\OpenSwarm\data`. Nothing is deleted; it is simply no longer read. Copy that folder across to migrate, or write a one-shot migration if this ever affects real users.

Related: `_removeLegacyNsisInstall` in `electron/main.js` now matches `Maestro Studio*` rather than `OpenSwarm*`. That is deliberate — installing Maestro Studio must not silently uninstall somebody's OpenSwarm.

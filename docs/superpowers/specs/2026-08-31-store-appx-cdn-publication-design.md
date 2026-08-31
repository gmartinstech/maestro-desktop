# Store AppX CDN Publication Design

## Goal

Provide a repeatable Windows release flow that publishes an existing Microsoft Store AppX as a static CDN download, without changing the Azure-signed Squirrel release or updater channel.

## Confirmed environment

- The existing release candidate is `electron/dist/MaestroStudio-Store-1.1879.0-x64.appx`.
- Its version is `1.1879.0`, SHA-256 is `ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71`, and embedded provenance is `bc8db86f347eb9fc450a0f07c87644425d501c4c` with channel `store`.
- The existing dashboard URL is `https://cdn.martinstech.net/maestro/download` (singular). The requested plural URL is currently absent.
- The CDN document root is `/home/martinstech-cdn/htdocs/cdn.martinstech.net`. Its existing `/maestro/` static-file routing will serve a new `maestro/downloads/` directory; no Nginx change is required.
- The SSH deploy account can stage files in `~/maestro-releases/incoming/` and has noninteractive sudo access. No credentials are recorded in the repository.

## Release paths

Store files are immutable static downloads:

```
https://cdn.martinstech.net/maestro/downloads/
  MaestroStudio-Store-1.1879.0-x64.appx
  MaestroStudio-Store-1.1879.0-x64.appx.json
```

The sidecar JSON has `schema`, `channel`, `file`, `version`, `sha256`, and `provenanceSha`. It is published only after its AppX is available.

Squirrel remains separate:

```
https://cdn.martinstech.net/maestro/
  version.json
  MaestroStudio-Setup-<version>-x64.exe
```

The Store publisher must never read, write, or upload `version.json`; AppX files never enter the Squirrel updater path.

## Local publisher

Add `scripts/publish-store-appx.ps1`, accepting an explicit `-ArtifactPath`. It must not rebuild the application. The script:

1. Requires a `.appx` file named `MaestroStudio-Store-<version>-x64.appx`.
2. Reads the packaged `AppxManifest.xml` and `app.asar` build info; validates AppX identity, matching version, `store` channel, and a full source SHA.
3. Computes SHA-256 and emits the sidecar JSON.
4. Requires `scp` and `ssh`, and uses the fixed `cloudinha` host, incoming directory, and Store-download document-root path recorded above.
5. Uploads AppX and JSON under unique `.partial` names into the non-public incoming directory.
6. Uses remote SHA-256 verification, then installs each file through a non-public temporary name in the CDN document root and renames the AppX before the sidecar JSON. A pre-existing final filename is an error; release artifacts are immutable.
7. Prints the public AppX URL and integrity record only after both remote files are present.

The target is constrained to the existing `cloudinha` release host and its Store-download directory. The script does not accept a user-controlled public URL, host, or web-root path.

## Safety boundaries

- Store AppX static hosting is the only exception to Azure signing for CDN-hosted artifacts.
- `scripts/build-app-win.ps1 -Publish` continues to require Azure Trusted Signing and continues to stage only Squirrel installers.
- `-Store` remains Azure-free and build-only. Static publishing is a separate command so the already-built AppX can be released without rebuilding it.
- The release candidate’s generated `.env` is accepted only when it has the expected public OAuth base-URL setting, has HTTPS, no userinfo, no query/fragment, and the expected gateway host/path. Its value is never printed.
- The server deployment uses temporary names and an atomic final rename so users cannot receive partial files.

## Dashboard and Partner Center

The existing dashboard is an external static file, not a repository source file. This change makes the plural static AppX URL live; a dashboard link can point to that exact immutable URL after the sidecar exists. Partner Center upload remains manual and uses the same verified AppX and integrity record.

## Verification

Automated tests cover filename/version validation, required Store provenance, metadata rendering, refusal to overwrite immutable files, failure on missing tools/configuration, and the guarantee that Store publication does not include `version.json` or a Squirrel installer. Manual verification uploads the known `1.1879.0` candidate, fetches the AppX and sidecar over HTTPS, compares SHA-256, confirms `version.json` is unchanged, and confirms the Store build still reports Store-managed updates.

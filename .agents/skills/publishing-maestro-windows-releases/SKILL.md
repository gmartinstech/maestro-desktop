---
name: publishing-maestro-windows-releases
description: Use when building, verifying, or publishing Maestro Studio Windows releases to the Microsoft Store static-download path or the Azure-signed Squirrel CDN channel.
---

# Publishing Maestro Windows Releases

Use the channel selected by the artifact, never by convenience. Store AppX files are immutable static downloads; Squirrel files drive direct-install updates.

| Artifact | Build / publish command | Public location | Update mechanism |
| --- | --- | --- | --- |
| `MaestroStudio-Store-<version>-x64.appx` | `pwsh scripts/publish-store-appx.ps1 -ArtifactPath <path>` | `/maestro/downloads/` | Microsoft Store |
| `MaestroStudio-Setup-<version>-x64.exe` | `pwsh scripts/build-app-win.ps1 -Publish` | `/maestro/` | Squirrel manifest |

## Store AppX static publication

1. Do not rebuild an existing verified artifact. Confirm its name matches `MaestroStudio-Store-<version>-x64.appx`.
2. Run the publisher with the exact artifact path. It validates the packaged identity, Store provenance, generated public OAuth URL, and SHA-256; it then atomically uploads the AppX and sidecar JSON.
3. Fetch the AppX and its `.json` sidecar from `https://cdn.martinstech.net/maestro/downloads/` and compare SHA-256 before announcing it.
4. Upload the same verified bytes manually to Partner Center when making a Store submission.

**Verified record:** `MaestroStudio-Store-1.1879.0-x64.appx`; SHA-256 `ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71`; provenance `bc8db86f347eb9fc450a0f07c87644425d501c4c`.

## Direct CDN/Squirrel publication

Run `pwsh scripts/build-app-win.ps1 -Publish`. It requires Azure Trusted Signing and stages only the signed Setup executable for the existing Squirrel promotion flow. Verify the published manifest and update behavior afterward.

## Stop conditions

- Never place an AppX in `version.json` or the Squirrel release directory.
- Never publish unsigned or self-signed Squirrel installers.
- Never use the Store AppX path as a substitute for Azure signing.
- Never enable CDN updating in a Store-packaged installation.
- Do not overwrite an existing versioned Store artifact; publish a new version instead.

# Store MSIX distribution design

**Status:** approved
**Date:** 2026-08-31

## Goal

Add Microsoft Store distribution without removing the existing Windows CDN/Squirrel channel. Store installs must use Store-managed trust and updates; direct CDN installs must retain the current Squirrel updater and may never be published unsigned.

This removes Azure Trusted Signing as a prerequisite for the Store path. It does not weaken the existing signed-CDN release safety rule.

## Distribution channels

| Channel | Artifact | Delivery | Update authority | Signing policy |
| --- | --- | --- | --- | --- |
| Microsoft Store | `.msix` / Store submission package | Partner Center manual submission | Microsoft Store | Store package identity and Store ingestion; no Azure Trusted Signing configuration |
| Direct download | Squirrel `MaestroStudio-Setup-<version>-x64.exe` | `cdn.martinstech.net` | Existing `cdnUpdater.js` + `version.json` | Azure Trusted Signing remains mandatory before upload |

The channels share source commit provenance and the build-derived `1.<effective-count>.0` version. They intentionally do not share updater feeds: Store-installed apps update only through the Store, and Squirrel-installed apps retain the CDN updater.

## Build interface

`build-app-win.ps1` gains a mutually exclusive Store submission mode:

```powershell
pwsh scripts/build-app-win.ps1 -Store
```

`-Store`:

1. Validates that the Store identity configuration is present.
2. Computes the same floored build version as every Windows artifact.
3. Builds an AppX/MSIX artifact configured with the Store-reserved identity.
4. Stamps `electron/build-info.json` with the source SHA, version, timestamp, and `channel: "store"`.
5. Prints the exact artifact path, SHA-256, version, and provenance for manual Partner Center upload.
6. Does not call Azure Trusted Signing, does not require Azure environment variables, does not scp to cloudinha, and does not alter CDN `version.json`.

Mode constraints:

- `-Store` cannot combine with `-Publish`, `-Sign`, `-DevSign`, `-DirOnly`, or `-Squirrel`.
- `-Publish` remains an Azure-signed Squirrel/CDN operation. Its current fail-closed Azure validation remains unchanged.
- A plain local build remains unsigned and is never uploaded by the script.

## Store configuration

The first Partner Center setup reserves the app identity. `.env.windows` is the authoritative source for the non-secret identity values required to reproduce a Store package; `.env.windows.example` names each required value and documents where Partner Center exposes it:

- Store identity name
- Store publisher distinguished name
- Store display name
- Store package family name, where needed by runtime detection

No Azure credentials, certificate private keys, Partner Center tokens, or Store secrets may be committed. `.env.windows.example` documents Store identity variables separately from Azure signing variables.

The final configuration uses electron-builder's Windows AppX/MSIX target with the reserved identity. Its artifact name includes the calculated version and architecture so the manual Store upload is auditable.

## Runtime behavior

A Store package identifies itself through package runtime metadata. On Store installs, `cdnUpdater.js` must not check, download, or launch Squirrel installers. On unpackaged and Squirrel/CDN installs, current CDN update behavior is unchanged.

The renderer's existing update UI receives Store state through a narrowly scoped Electron IPC capability. If the Store supports opening its product page/update view, that action is delegated to the OS/Store rather than downloading an EXE. If no Store update API is available, UI must state that updates are managed by Microsoft Store and offer an `Open Microsoft Store` action.

Detection is isolated behind an Electron-side helper, with unit tests for Store-packaged, Squirrel/CDN, and unpackaged development states. The backend has no Store-specific behavior.

## Publishing procedure

1. Build and verify the exact `main` commit with `-Store`.
2. Upload the emitted MSIX/AppX artifact manually in Partner Center.
3. Complete Store certification and publish through Partner Center.
4. Verify a Store-installed app reports the expected build SHA and that it does not contact the CDN updater.
5. Retain the CDN release procedure as documented. If a direct-download release is also needed, run `-Publish` only in an environment with Azure signing credentials; Store publication never authorizes an unsigned CDN upload.

The two channels can ship at different times. A Store approval delay never blocks an already-safe Azure-signed CDN release, and lack of Azure credentials never blocks Store submission.

## Error handling

- Missing Store identity config: fail before build with each missing variable and a Partner Center association instruction.
- `-Store` combined with an incompatible release flag: fail before build and name the conflicting flags.
- Store package build failure: leave no claim that a release was published; preserve artifact logs and provenance.
- Runtime Store detection failure: default to the existing CDN path only when the app is positively not Store-packaged. An uncertain packaged state disables CDN auto-update and reports a diagnostic rather than risking an unsupported installer over a Store app.
- Partner Center rejection/certification delay: no automatic fallback to an unsigned CDN upload.

## Verification

Automated checks will cover:

- argument validation for all Store/CDN/signing mode combinations;
- Store build command construction, version floor, identity values, and provenance channel;
- Store runtime detection and CDN updater suppression;
- Store update UI IPC state;
- no regression to Squirrel/CDN build, update, manifest, and call-home checks.

Manual release checks will cover:

- Partner Center upload accepts the package;
- an installed Store package reports the matching commit SHA;
- Store updates occur through Windows/Microsoft Store;
- a Store-installed app does not fetch the CDN manifest;
- direct CDN install/update remains functional from the existing signed release flow.

## Non-goals

- Automating Partner Center submissions or storing Partner Center credentials.
- Moving the existing CDN channel to MSIX.
- Publishing unsigned or self-signed artifacts to public CDN.
- Changing macOS distribution.

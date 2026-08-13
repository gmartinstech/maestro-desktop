// Version-comparison logic for the Windows CDN updater. Kept separate from main.js, and free of
// any Electron/network/filesystem dependency, so "is this newer?" and "is this manifest usable?"
// are unit-testable without spinning up Electron or a real HTTP call. main.js owns the fetch,
// the download, the sha256 verification of the downloaded bytes, and the install/spawn step --
// this module only ever sees already-parsed JSON and version strings.

const CDN_MANIFEST_URL = 'https://cdn.martinstech.net/maestro/version.json';

// Every version is "1.<commitCount>.0" (see docs/superpowers/specs/2026-08-13-cdn-version-management-design.md).
// The trailing ".0" isn't decorative -- electron-builder's `${version}` artifactName token and
// app.getVersion() both resolve to the full package.json version string, and Squirrel/NuGet
// requires three dotted segments, so the real runtime version is always three-part. Extracting
// the count lets two versions compare as integers -- "1.9.0" vs "1.10.0" would come out backwards
// under plain string/semver comparison, and the commit count is the only part that ever changes.
function commitCountFromVersion(version) {
  const match = /^1\.(\d+)\.0$/.exec(String(version == null ? '' : version).trim());
  return match ? Number(match[1]) : null;
}

// Returns the manifest's `latest` release object if it's newer than `currentVersion`, else null.
// Null covers every "don't update" case on purpose (no release yet, already current, malformed
// manifest) so main.js has exactly one branch to handle instead of separately guarding each cause
// -- a bad or half-written manifest on the CDN must never crash the app or loop an update prompt.
function pickUpdate(manifest, currentVersion) {
  const latest = manifest && manifest.latest;
  if (!latest || !latest.version || !latest.url || !latest.sha256) return null;
  const latestCount = commitCountFromVersion(latest.version);
  const currentCount = commitCountFromVersion(currentVersion);
  if (latestCount === null || currentCount === null) return null;
  if (latestCount <= currentCount) return null;
  return latest;
}

module.exports = { CDN_MANIFEST_URL, commitCountFromVersion, pickUpdate };

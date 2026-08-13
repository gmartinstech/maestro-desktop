const test = require('node:test');
const assert = require('node:assert/strict');
const { CDN_MANIFEST_URL, commitCountFromVersion, pickUpdate } = require('./cdnUpdater');

test('CDN_MANIFEST_URL points at the maestro CDN path', () => {
  assert.equal(CDN_MANIFEST_URL, 'https://cdn.martinstech.net/maestro/version.json');
});

test('commitCountFromVersion parses "1.N.0" into N', () => {
  assert.equal(commitCountFromVersion('1.482.0'), 482);
  assert.equal(commitCountFromVersion('1.0.0'), 0);
});

test('commitCountFromVersion returns null for anything else', () => {
  assert.equal(commitCountFromVersion(''), null);
  assert.equal(commitCountFromVersion(null), null);
  assert.equal(commitCountFromVersion(undefined), null);
  assert.equal(commitCountFromVersion('482'), null);
  assert.equal(commitCountFromVersion('2.482.0'), null);
  assert.equal(commitCountFromVersion('1.482'), null);
  assert.equal(commitCountFromVersion('1.482.1'), null);
  assert.equal(commitCountFromVersion('1.abc.0'), null);
});

test('pickUpdate returns the latest release when it is newer', () => {
  const manifest = {
    latest: {
      version: '1.482.0',
      commitCount: 482,
      file: 'MaestroStudio-Setup-1.482.0-x64.exe',
      url: 'https://cdn.martinstech.net/maestro/MaestroStudio-Setup-1.482.0-x64.exe',
      sha256: 'abc123',
      releasedAt: '2026-08-13T18:00:00Z',
    },
    history: ['1.482.0', '1.479.0', '1.475.0'],
  };
  assert.deepEqual(pickUpdate(manifest, '1.475.0'), manifest.latest);
});

test('pickUpdate returns null when already on the latest or newer version', () => {
  const manifest = { latest: { version: '1.482.0', url: 'u', sha256: 's' }, history: [] };
  assert.equal(pickUpdate(manifest, '1.482.0'), null);
  assert.equal(pickUpdate(manifest, '1.500.0'), null);
});

test('pickUpdate returns null for a manifest with no release yet', () => {
  assert.equal(pickUpdate({ latest: null, history: [] }, '1.1.0'), null);
  assert.equal(pickUpdate(null, '1.1.0'), null);
});

test('pickUpdate returns null when latest is missing url or sha256 (malformed manifest)', () => {
  assert.equal(pickUpdate({ latest: { version: '1.482.0' }, history: [] }, '1.1.0'), null);
  assert.equal(pickUpdate({ latest: { version: '1.482.0', url: 'u' }, history: [] }, '1.1.0'), null);
});

test('pickUpdate returns null when either version string fails to parse', () => {
  const manifest = { latest: { version: 'not-a-version', url: 'u', sha256: 's' }, history: [] };
  assert.equal(pickUpdate(manifest, '1.1.0'), null);
  assert.equal(pickUpdate({ latest: { version: '1.482.0', url: 'u', sha256: 's' }, history: [] }, 'not-a-version'), null);
});

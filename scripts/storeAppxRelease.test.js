const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStoreArtifact, STORE_CDN } = require('./storeAppxRelease');

const valid = {
  fileName: 'MaestroStudio-Store-1.1879.0-x64.appx',
  identityName: 'MaestroStudio',
  publisher: 'CN=MartinsTech',
  expectedIdentityName: 'MaestroStudio',
  expectedPublisher: 'CN=MartinsTech',
  buildInfo: {
    channel: 'store',
    version: '1.1879.0',
    sha: 'bc8db86f347eb9fc450a0f07c87644425d501c4c',
  },
  oauthBaseUrl: 'https://llm.martinstech.net/v1',
  sha256: 'ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71',
};

test('creates immutable Store CDN metadata from a validated Store package', () => {
  assert.deepEqual(validateStoreArtifact(valid), {
    schema: 1,
    channel: 'store-static-download',
    file: valid.fileName,
    version: '1.1879.0',
    sha256: valid.sha256,
    provenanceSha: valid.buildInfo.sha,
  });
});

test('rejects a Squirrel filename, non-Store provenance, identity mismatch, and credentialed OAuth URL', () => {
  for (const patch of [
    { fileName: 'MaestroStudio-Setup-1.1879.0-x64.exe' },
    { buildInfo: { ...valid.buildInfo, channel: 'stable' } },
    { identityName: 'other' },
    { oauthBaseUrl: 'https://token@example.test/v1' },
  ]) {
    assert.throws(() => validateStoreArtifact({ ...valid, ...patch }));
  }
});

test('uses the fixed Store-download path and never a Squirrel manifest', () => {
  assert.equal(STORE_CDN.host, 'cloudinha');
  assert.equal(STORE_CDN.publicBaseUrl, 'https://cdn.martinstech.net/maestro/downloads');
  assert.match(STORE_CDN.publicDir, /\/maestro\/downloads$/);
  assert.match(STORE_CDN.stagingDir, /\/maestro-releases\/incoming$/);
  assert.equal(JSON.stringify(STORE_CDN).includes('version.json'), false);
});

test('publisher accepts an existing artifact and cannot rebuild or touch Squirrel metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, 'publish-store-appx.ps1'), 'utf8');
  assert.match(source, /\[Parameter\(Mandatory\)\]\[ValidateNotNullOrEmpty\(\)\]\[string\]\$ArtifactPath/);
  assert.match(source, /storeAppxRelease\.js/);
  assert.match(source, /\.partial/);
  assert.doesNotMatch(source, /electron-builder|build-app-win\.ps1|version\.json/);
});

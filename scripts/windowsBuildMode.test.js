const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AZURE_SIGNING_ENV, STORE_IDENTITY_ENV, resolveWindowsBuildMode } = require('./windowsBuildMode');

const storeEnv = Object.fromEntries(STORE_IDENTITY_ENV.map((name) => [name, `value-for-${name}`]));

test('Store mode uses AppX and never requires Azure signing', () => {
  const mode = resolveWindowsBuildMode({ store: true }, storeEnv);
  assert.equal(mode.channel, 'store');
  assert.equal(mode.requiresAzureSigning, false);
  assert.deepEqual(mode.targetArgs.slice(0, 2), [
    '--config.win.target=appx',
    '--config.appx.identityName=value-for-MAESTRO_STORE_IDENTITY_NAME',
  ]);
});

test('Store mode reports every missing Partner Center identity value', () => {
  assert.throws(
    () => resolveWindowsBuildMode({ store: true }, {}),
    /MAESTRO_STORE_IDENTITY_NAME.*MAESTRO_STORE_PUBLISHER.*MAESTRO_STORE_PUBLISHER_DISPLAY_NAME/s,
  );
});

test('Store mode rejects every incompatible release flag', () => {
  for (const flag of ['publish', 'sign', 'devSign', 'dirOnly', 'squirrel']) {
    const label = flag === 'devSign' ? 'DevSign' : `${flag[0].toUpperCase()}${flag.slice(1)}`;
    assert.throws(
      () => resolveWindowsBuildMode({ store: true, [flag]: true }, storeEnv),
      new RegExp(`-Store cannot be combined with -${label}`),
    );
  }
});

test('CDN publish remains Azure-gated', () => {
  const mode = resolveWindowsBuildMode({ publish: true }, {});
  assert.equal(mode.channel, 'stable');
  assert.equal(mode.requiresAzureSigning, true);
  assert.deepEqual(mode.missingAzureEnv, AZURE_SIGNING_ENV);
});

test('Store artifact naming cannot be confused with CDN Squirrel naming', () => {
  const mode = resolveWindowsBuildMode({ store: true }, storeEnv);
  assert.ok(mode.targetArgs.includes('--config.appx.artifactName=MaestroStudio-Store-${version}-${arch}.${ext}'));
  assert.ok(!mode.targetArgs.some((arg) => arg.includes('squirrelWindows')));
});

test('Azure-required releases clear the dev-only signing skip before packaging', () => {
  const script = fs.readFileSync(path.join(__dirname, 'build-app-win.ps1'), 'utf8');
  assert.match(
    script,
    /if \(\$BuildMode\.requiresAzureSigning\) \{[\s\S]*?Remove-Item -Path 'Env:CSC_IDENTITY_AUTO_DISCOVERY' -ErrorAction SilentlyContinue/,
  );
});

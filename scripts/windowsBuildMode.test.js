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

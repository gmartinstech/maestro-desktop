const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { authTokenPath } = require('./backendPaths');

test('MAESTRO_DATA_ROOT owns packaged auth.token', () => {
  assert.equal(
    authTokenPath({
      isPackaged: true,
      env: { MAESTRO_DATA_ROOT: 'C:/tmp/e2e-data' },
      platform: 'win32',
      home: 'C:/Users/test',
    }),
    path.join('C:/tmp/e2e-data', 'auth.token'),
  );
});

test('packaged Windows without an override uses AppData', () => {
  assert.equal(
    authTokenPath({
      isPackaged: true,
      env: { APPDATA: 'C:/Users/test/AppData/Roaming' },
      platform: 'win32',
      home: 'C:/Users/test',
    }),
    path.join('C:/Users/test/AppData/Roaming', 'Maestro Studio', 'data', 'auth.token'),
  );
});

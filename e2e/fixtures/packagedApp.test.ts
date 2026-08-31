import test from 'node:test';
import assert from 'node:assert/strict';
import { descendantPids, seededSettings } from './packagedApp';

test('generic settings seed contains no provider credential', () => {
  assert.deepEqual(seededSettings(), {
    user_id: 'e2e-fake-user',
    user_email: 'e2e@maestro.test',
    language: 'en',
  });
});

test('process ownership follows the Electron process tree', () => {
  const processes = [
    { pid: 10, parentPid: 1 },
    { pid: 11, parentPid: 10 },
    { pid: 12, parentPid: 11 },
    { pid: 20, parentPid: 1 },
  ];
  assert.deepEqual(descendantPids(10, processes), [10, 11, 12]);
});

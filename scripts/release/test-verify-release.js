#!/usr/bin/env node
// Phase 5a test: hermetic checks of the promotion gate. Builds throwaway
// latest*.yml fixtures and asserts the gate promotes a good release and blocks
// the failures the gate exists for: a missing feed, an unparseable feed, and a
// version that disagrees with the tag.
// No network (URL checking is exercised separately in CI with --base-url).
//
//   node scripts/release/test-verify-release.js

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const NODE = process.execPath;
let passed = 0;

function assert(cond, msg) {
  if (!cond) { process.stderr.write(`\nASSERT FAILED: ${msg}\n`); process.exit(1); }
  passed++;
}

function run(args) {
  try {
    const stdout = execFileSync(NODE, [path.join(HERE, 'verify-release.js'), ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function feed(version, asset) {
  return `version: ${version}\nfiles:\n  - url: ${asset}\n    sha512: deadbeef\n    size: 123\npath: ${asset}\nsha512: deadbeef\nreleaseDate: '2026-05-27T00:00:00.000Z'\n`;
}

function mkdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'osw-rel-')); }

// (1) good release: the Windows feed, version matches expected -> promotable
(() => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'latest.yml'), feed('1.2.3', 'MaestroStudio-Setup-x64.exe'));
  const r = run(['--dir', d, '--expect-version', '1.2.3', '--json']);
  assert(r.code === 0, `good release should pass, got ${r.code}`);
  assert(JSON.parse(r.stdout).version === '1.2.3', 'should report version 1.2.3');
  // tolerate a leading v on expected
  assert(run(['--dir', d, '--expect-version', 'v1.2.3', '--json']).code === 0, 'leading-v expected should pass');
  fs.rmSync(d, { recursive: true, force: true });
})();

// (2) no feed at all (the publish uploaded assets but no manifest) -> blocked
(() => {
  const d = mkdir();
  const r = run(['--dir', d, '--expect-version', '1.2.3']);
  assert(r.code === 1, 'missing latest.yml should block');
  fs.rmSync(d, { recursive: true, force: true });
})();

// (3) feed present but unparseable (no version: field) -> blocked
(() => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'latest.yml'), 'files:\n  - url: MaestroStudio-Setup-x64.exe\n');
  const r = run(['--dir', d, '--expect-version', '1.2.3']);
  assert(r.code === 1, 'feed with no version: should block');
  fs.rmSync(d, { recursive: true, force: true });
})();

// (4) feed is internally consistent but not the version being tagged -> blocked
(() => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'latest.yml'), feed('1.2.0', 'MaestroStudio-Setup-x64.exe'));
  const r = run(['--dir', d, '--expect-version', '1.2.3']);
  assert(r.code === 1, 'expected-version mismatch should block');
  fs.rmSync(d, { recursive: true, force: true });
})();

process.stdout.write(`\nPhase 5a promotion gate: ${passed} assertions passed.\n`);

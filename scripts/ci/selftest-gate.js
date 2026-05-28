#!/usr/bin/env node
// Test-the-tests: feeds broken backend.logs to the boot check and asserts each guard fires (a good log passes); if a break stops going red, the gate is theater. Live-process guards: see GATE_AUDIT.md.

'use strict';
const h = require('./lib/app-harness');

let failed = 0;
function check(name, cond) { process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}\n`); if (!cond) failed++; }
const caught = (log, head, re) => h.bootFailures({ log, headShort: head }).failures.some((f) => re.test(f));

const HEAD = 'abc123def456';
const GOOD = [
  '[provenance] OpenSwarm 1.1.69 sha=abc123def456 channel=stable builtAt=2026-01-01T00:00:00Z',
  '[perf] app-launch t=100',
  '[perf] first-paint t=400',
  '[perf] backend-http-ready t=4000',
  'Backend ready on port 8324',
].join('\n');

process.stdout.write('boot-check mutation tests:\n');

// Baseline: a good log must PASS (no false positives - the inverse failure mode).
check('good log -> 0 failures (no false alarm)', h.bootFailures({ log: GOOD, headShort: HEAD }).failures.length === 0);

// Each mutation must be CAUGHT:
check('missing [provenance] -> caught', caught(GOOD.replace(/\[provenance\].*/, ''), HEAD, /provenance/));
check('sha != HEAD -> caught', caught(GOOD.replace('abc123def456', '000000000000'), HEAD, /!= git HEAD/));
check('missing first-paint mark -> caught', caught(GOOD.replace(/\[perf\] first-paint t=400\n/, ''), HEAD, /first-paint/));
check('missing backend-http-ready mark -> caught', caught(GOOD.replace(/\[perf\] backend-http-ready t=4000/, ''), HEAD, /backend-http-ready/));
check('out-of-order marks -> caught', caught(GOOD.replace('first-paint t=400', 'first-paint t=9999'), HEAD, /out of order/));
check('degenerate all-zero marks -> caught', caught(
  '[provenance] OpenSwarm 1 sha=abc123def456 channel=stable\n[perf] app-launch t=0\n[perf] first-paint t=0\n[perf] backend-http-ready t=0',
  HEAD, /> 0|degenerate/));

// A stale build (old sha, all marks fine) must still be caught - the case we saw fire live.
check('stale build (every mark fine, wrong sha) -> still caught', caught(GOOD.replace('abc123def456', 'deadbeef0000'), HEAD, /!= git HEAD/));

process.stdout.write('\nparse-function edge cases:\n');
check('parseProvenanceSha reads a real line', h.parseProvenanceSha(GOOD) === 'abc123def456');
check('parseProvenanceSha returns null on no marker', h.parseProvenanceSha('nothing here') === null);
check('parsePerfMarks finds all three', Object.keys(h.parsePerfMarks(GOOD)).length === 3);

process.stdout.write(failed
  ? `\nGATE SELFTEST FAIL: ${failed} guard(s) did not discriminate - the gate has theater in it.\n`
  : '\nGATE SELFTEST PASS: every boot guard fires on a break and passes on good input.\n');
process.exit(failed ? 1 : 0);

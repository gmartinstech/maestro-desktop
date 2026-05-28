#!/usr/bin/env node
// Reports code-signing state; --require-signed fails unless signed (release CI gate, post-sign). Local builds are unsigned by design. Win: Authenticode Valid; mac: codesign + spctl + staple.

'use strict';
const { execSync } = require('child_process');
const h = require('./lib/app-harness');

function parseArgs(argv) {
  const out = { target: null, requireSigned: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') out.target = argv[++i];
    else if (argv[i] === '--require-signed') out.requireSigned = true;
  }
  return out;
}

function sh(cmd) {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).toString().trim(), code: e.status }; }
}

// Windows: Authenticode status + signer subject via Get-AuthenticodeSignature.
function inspectWindows(target) {
  const ps = `$ErrorActionPreference='SilentlyContinue'; $s = Get-AuthenticodeSignature -LiteralPath '${target}'; '{0}|{1}' -f $s.Status, ($s.SignerCertificate.Subject)`;
  const r = sh(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`);
  const [status, subject] = (r.out || '').split('|');
  const signed = (status || '').trim() === 'Valid';
  return { signed, status: (status || 'Unknown').trim(), signer: (subject || '').trim() };
}

// macOS: codesign validity + Gatekeeper assessment + notarization staple.
function inspectMac(target) {
  const cs = sh(`codesign --verify --deep --strict --verbose=2 "${target}"`);
  const assess = sh(`spctl --assess --type execute --verbose=4 "${target}"`);
  const staple = sh(`xcrun stapler validate "${target}"`);
  const signed = cs.ok && assess.ok;
  const status = `codesign=${cs.ok ? 'valid' : 'invalid'} gatekeeper=${assess.ok ? 'accepted' : 'rejected'} staple=${staple.ok ? 'present' : 'absent'}`;
  return { signed, status, signer: (cs.out.match(/Authority=(.+)/) || [])[1] || '' };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = h.signableTarget(args.target || h.packagedAppPath());
  process.stdout.write(`Inspecting signature: ${target}\n`);

  let info;
  if (process.platform === 'win32') info = inspectWindows(target);
  else if (process.platform === 'darwin') info = inspectMac(target);
  else { process.stdout.write('  (linux: no code-signing model checked)\n'); process.exit(0); }

  process.stdout.write(`  signed = ${info.signed}\n  status = ${info.status}\n`);
  if (info.signer) process.stdout.write(`  signer = ${info.signer}\n`);

  if (args.requireSigned && !info.signed) {
    process.stderr.write(`\nSIGNATURE FAIL: --require-signed but artifact is not validly signed (${info.status}).\n`);
    process.exit(1);
  }
  if (!info.signed) process.stdout.write('\nNOTE: artifact is UNSIGNED (expected for a local dev build; CI signs on v* tags).\n');
  else process.stdout.write('\nSIGNATURE OK: artifact is validly signed.\n');
  process.exit(0);
}

main();

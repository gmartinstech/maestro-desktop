#!/usr/bin/env node
// Verifies that every `build-staging/<dir>` electron/package.json's extraResources
// declares is actually staged by the Windows build script. A drift here means
// electron-builder fails at pack time (or, worse, packs an empty dir) because the
// manifest promises a tree the build never produced.
//
// This used to be a Win<->Mac parity check. macOS was dropped, so Windows is the
// whole matrix; the manifest-vs-staging half of the check is what still earns its
// keep. If a second platform is ever added, restore the set-difference between the
// two build scripts' staged dirs here.

'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./lib/app-harness');

const winScript = path.join(h.REPO_ROOT, 'scripts', 'build-app-win.ps1');
const pkgJson = path.join(h.REPO_ROOT, 'electron', 'package.json');

// Pull every literal that mentions a dir under the staging root. PowerShell uses
// $Staging\<name> or $Staging/<name>, and may write build-staging/<name> outright.
function extractStagingDirs(text) {
  const dirs = new Set();
  const patterns = [
    // PowerShell: Join-Path $Staging '<name>...' or "<name>..."
    /Join-Path\s+\$Staging\s+['"](?<name>[a-zA-Z0-9._-]+)/g,
    // literal build-staging/<name> or build-staging\<name>
    /build-staging[\\/](?<name>[a-zA-Z0-9._-]+)/g,
  ];
  for (const re of patterns) { let m; while ((m = re.exec(text))) if (m.groups.name) dirs.add(m.groups.name); }
  return Array.from(dirs).sort();
}

function extractExtraResourceFroms(pkg) {
  const list = ((pkg.build || {}).extraResources) || [];
  return list.map((e) => e.from).filter(Boolean);
}

function main() {
  const winText = fs.readFileSync(winScript, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  const winDirs = extractStagingDirs(winText);
  const resFroms = extractExtraResourceFroms(pkg);

  process.stdout.write(`Win build-staging dirs : ${winDirs.join(', ')}\n`);
  process.stdout.write(`extraResources from[]  : ${resFroms.join(', ')}\n`);

  let failed = 0;

  // Every extraResource from path that references build-staging/X must have X
  // staged by the build script, or electron-builder packs nothing for it.
  const stagingResources = resFroms.filter((p) => /^build-staging[\\/]/.test(p));
  if (!stagingResources.length) {
    process.stderr.write('  FAIL  extraResources declares no build-staging/* source - the staged tree would not ship\n');
    failed++;
  }
  for (const r of stagingResources) {
    const sub = r.split(/[\\/]/)[1].replace(/\$\{arch\}/g, ''); // strip arch templating
    if (!winDirs.includes(sub)) {
      process.stderr.write(`  FAIL  extraResources from ${r} - "${sub}" is not staged by build-app-win.ps1\n`);
      failed++;
    } else {
      process.stdout.write(`  ok   extraResources from ${r}\n`);
    }
  }

  if (failed) { process.stderr.write(`\nPACKAGING-STAGING FAIL: ${failed} divergence(s) between electron/package.json and build-app-win.ps1.\n`); process.exit(1); }
  process.stdout.write('\nPACKAGING-STAGING PASS: every extraResources source is staged by the Windows build.\n');
  process.exit(0);
}

main();

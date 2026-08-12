// scripts/check-fork-drift.mjs
// Fails when an upstream merge/cherry-pick drags back something the fork deliberately removed.
// This is a GUARD: it holds the old names on purpose. Never "clean up" the literals below.
//
// Three classes of drift, each of which has actually happened or nearly happened:
//   1. Legacy identifiers (openswarm / self-swarm / Open Swarm) reappearing in source.
//   2. Deleted subsystems (cloud auth, paid subscription, publish-to-web, edge) coming back.
//   3. A call-home host or the old proxy default sneaking into a default value.
import { execSync } from 'node:child_process';

// Files that legitimately contain the old names, with the reason. Anything here is exempt.
const ALLOW = [
  ['scripts/check-callhome.mjs', 'the call-home detector must name the hosts it blocks'],
  ['scripts/check-fork-drift.mjs', 'this guard names what it forbids'],
  ['harness/review.mjs', 'the reviewer prompt names the banned host'],
  ['frontend/src/shared/legacyStorageKeys.ts', 'localStorage migration table needs the old keys'],
  ['backend/apps/settings/store.py', 'settings-key migration table needs the old names'],
  ['backend/config/state_paths.py', 'LEGACY_STATE_DIR_NAME for the ~/.openswarm move'],
  ['backend/apps/outputs/workspace_io.py', 'legacy state dir stays in the export-skip set'],
  ['backend/apps/outputs/webapp_template/frontend/src/shared/styles/ThemeContext.tsx', 'legacy theme key migration'],
  ['LICENSE', 'upstream copyright, retained'],
  ['NOTICE', 'MIT attribution, required'],
  ['README.md', 'fork provenance, required by MIT'],
  ['AGENTS.md', 'fork provenance'],
  ['CLAUDE.md', 'fork provenance'],
  ['GETTING_STARTED.md', 'fork provenance'],
  ['docs/HANDOFF.md', 'historical narrative'],
  ['docs/UPSTREAM.md', 'documents what must not come back'],
  ['docs/WINDOWS_INSTALLER.md', 'paragraphs about the rename itself'],
];
const ALLOW_PREFIX = ['docs/plans/', 'docs/specs/', 'docs/perf/', 'docs/superpowers/', 'docs/ops/', 'backend/tests/', 'backend/mcp-bundles/', 'electron/build-staging/', 'electron/dist/', 'debugger/build/', 'node_modules/'];

// Narrower than a file exemption: these exact strings are allowed ANYWHERE, so a big file stays
// guarded for everything else. (The Apple keychain access group used to live here, pinned to
// upstream's signed provisioning profile. It went away with the macOS build pipeline — do not
// re-add it: an upstream mac commit dragging it back is exactly the drift this guard catches.)
const ALLOW_STRINGS = [
  'fork of Open Swarm',
  'legacy `self-swarm-language`',
  'reaches openswarm-ai. Sync the fork',
];

// Paths whose reappearance means a deleted subsystem came back with an upstream change.
const FORBIDDEN_PATHS = [
  'backend/apps/auth/', 'backend/apps/subscription/', 'openswarm-edge/',
  'backend/apps/outputs/publish_cloud.py', 'backend/apps/outputs/publish_scan.py',
  'backend/apps/outputs/publish_build.py', 'backend/apps/outputs/publish_common.py',
  'electron/installerFilenameAttribution.js',
];

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }); } catch (e) { return e.stdout || ''; }
}
const exempt = (f) => ALLOW.some(([p]) => f === p) || ALLOW_PREFIX.some((p) => f.startsWith(p));
const exemptLine = (line) => ALLOW_STRINGS.some((s) => line.includes(s));

let bad = [];

// 1. legacy identifiers in tracked source
const idHits = sh(`git grep -inIE "(open|self)[-_ ]?swarm" -- . ":!node_modules"`).trim().split('\n').filter(Boolean);
for (const line of idHits) {
  const file = line.split(':')[0].replace(/\\/g, '/');
  if (!exempt(file) && !exemptLine(line)) bad.push(`legacy identifier: ${line.slice(0, 160)}`);
}

// 2. deleted subsystems back on disk
const tracked = new Set(sh('git ls-files').split('\n').map((f) => f.trim().replace(/\\/g, '/')));
for (const p of FORBIDDEN_PATHS) {
  const hit = [...tracked].find((f) => f === p || f.startsWith(p));
  if (hit) bad.push(`deleted subsystem is back: ${hit} (matches ${p})`);
}

// 3. a call-home host or the retired proxy default in a default value
const hostHits = sh(`git grep -inIE "api\\.openswarm|openswarm\\.(com|ai|io|net)" -- . ":!node_modules"`).trim().split('\n').filter(Boolean);
for (const line of hostHits) {
  const file = line.split(':')[0].replace(/\\/g, '/');
  if (!exempt(file) && !exemptLine(line)) bad.push(`call-home host: ${line.slice(0, 160)}`);
}

if (bad.length) {
  console.error(`\nFORK DRIFT — ${bad.length} finding(s). An upstream change reintroduced something we removed:\n`);
  for (const b of bad) console.error(`  - ${b}`);
  console.error(`\nIf a finding is legitimate (a new migration table, say), add its path to ALLOW in scripts/check-fork-drift.mjs with a reason.`);
  console.error(`Read docs/UPSTREAM.md before deciding it is fine.\n`);
  process.exit(1);
}
console.log('fork drift: clean');

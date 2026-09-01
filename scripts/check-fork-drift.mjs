// scripts/check-fork-drift.mjs
// Fails when an upstream merge/cherry-pick drags back something the fork deliberately removed.
// This is a GUARD: it holds the old names on purpose. Never "clean up" the literals below.
//
// Five classes of drift, each of which has actually happened or nearly happened:
//   1. Legacy identifiers (openswarm / self-swarm / Open Swarm) reappearing in source.
//   2. Deleted subsystems (cloud auth, paid subscription, publish-to-web, edge) coming back.
//   3. A call-home host or the old proxy default sneaking into a default value.
//   4. Upstream is English-only; a careless cherry-pick conflict resolution can revert a t() call
//      back to a hardcoded English literal in a file we localized. See docs/UPSTREAM.md.
//   5. A cherry-pick from upstream authored after their MIT -> AGPL-3.0 relicense (2026-07-23).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
const ALLOW_PREFIX = ['docs/plans/', 'docs/specs/', 'docs/perf/', 'docs/superpowers/', 'docs/ops/', 'backend/tests/', 'backend/mcp-bundles/', 'electron/build-staging/', 'electron/dist/', 'debugger/build/', 'tauri/gen/', 'node_modules/'];

// Narrower than a file exemption: these exact strings are allowed ANYWHERE, so a big file stays
// guarded for everything else. (The Apple keychain access group used to live here, pinned to
// upstream's signed provisioning profile. It went away with the macOS build pipeline — do not
// re-add it: an upstream mac commit dragging it back is exactly the drift this guard catches.)
const ALLOW_STRINGS = [
  'fork of Open Swarm',
  'legacy `self-swarm-language`',
  'reaches openswarm-ai. Sync the fork',
  // "Skill Builder" is a feature/brand name kept literal in BOTH locales on purpose (see
  // pt-BR.json's "Inicializando o Skill Builder…"), not an untranslated English string.
  '>Skill Builder<',
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

// 4. i18n regression: upstream has no i18n at all, so a cherry-pick conflict resolution that takes
// upstream's version of a file we localized silently ships a hardcoded English literal to every
// user (pt-BR is the default). Scoped narrowly to avoid noise: only files that import useTranslation,
// and only a literal JSX text node or a label=/placeholder=/aria-label= attribute value that is at
// least two capitalized-start words (so single identifiers, URLs, and numbers never match).
const JSX_TEXT_RE = />\s*([A-Z][a-zA-Z]*(?:\s[a-zA-Z][a-zA-Z']*){1,})[.,!?:;]*\s*</g;
const ATTR_RE = /\b(label|placeholder|aria-label)=["']([A-Z][a-zA-Z]*(?:\s[a-zA-Z][a-zA-Z']*){1,})["']/g;
const i18nCandidateFiles = [...tracked].filter((f) => f.endsWith('.tsx') && f.startsWith('frontend/src/'));
for (const f of i18nCandidateFiles) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (!text.includes('useTranslation')) continue;
  text.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || exemptLine(line)) return;
    let m;
    JSX_TEXT_RE.lastIndex = 0;
    while ((m = JSX_TEXT_RE.exec(line))) bad.push(`i18n regression: hardcoded literal in JSX text — ${f}:${idx + 1}: "${m[1]}"`);
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(line))) bad.push(`i18n regression: hardcoded literal in ${m[1]}= — ${f}:${idx + 1}: "${m[2]}"`);
  });
}

// 5. AGPL contamination: upstream relicensed MIT -> AGPL-3.0 on 2026-07-23, so a cherry-pick from a
// commit authored on or after that date cannot ship under our MIT license. See docs/UPSTREAM.md.
// These eight ARE the contamination, already reverted in 27a9e623 with their modules deleted; the
// trailers live in history forever, so they are exempt by sha rather than failing the build always.
// Never extend this list to silence a NEW pick — re-implement the fix instead.
const REVERTED_PICKS = new Set(['567b0e12', 'd5ee9661', '10b019bd', 'de8faa36', 'fc1b4332', '5a017354', 'fe0116f6', '7231cf7e']);
for (const line of sh('git log --format=%H%x09%s -n 400 HEAD').trim().split('\n').filter(Boolean)) {
  const [sha, subj] = line.split('\t');
  if (!sha || REVERTED_PICKS.has(sha.slice(0, 8))) continue;
  const m = /cherry picked from commit ([0-9a-f]{7,40})/i.exec(sh(`git log -1 --format=%b ${sha}`));
  if (!m) continue;
  // An unresolvable source is expected now that the remote is gone, so surface it for a human
  // rather than assuming it predates the relicense.
  const when = sh(`git log -1 --format=%ad --date=short ${m[1]}`).trim();
  if (!when || when >= '2026-07-23') bad.push(`AGPL cherry-pick: ${sha.slice(0, 8)} <- ${m[1].slice(0, 8)} (${when || 'source unknown'}) ${String(subj).slice(0, 60)}`);
}

if (bad.length) {
  console.error(`\nFORK DRIFT — ${bad.length} finding(s). An upstream change reintroduced something we removed:\n`);
  for (const b of bad) console.error(`  - ${b}`);
  console.error(`\nIf a finding is legitimate (a new migration table, say), add its path to ALLOW in scripts/check-fork-drift.mjs with a reason.`);
  console.error(`Read docs/UPSTREAM.md before deciding it is fine.\n`);
  process.exit(1);
}
console.log('fork drift: clean');

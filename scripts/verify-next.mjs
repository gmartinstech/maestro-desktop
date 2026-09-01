// scripts/verify-next.mjs — quality gate for the TXM (TypeScript-migration) track.
//
// This is a NEW, separate gate from scripts/verify.mjs, which stays byte-identical as the
// frozen gate for the old Electron+Python stack. This one checks the migration's own invariants:
// the frozen HTTP contract, the contract test suite (CTR-3) plus the golden-turn WS spec (CTR-4)
// when it isn't already covered by that suite, call-home and fork-drift (both extended in CTR-6),
// and i18n parity if that check exists yet. `npm run verify:all` runs the old gate then this one.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const steps = [
  ['contract-freeze', 'node scripts/gen-contract.mjs --check'],
  ['contract-tests',  'npm run test:contract'],
  // e2e/contract/golden-turn.spec.ts (CTR-4) boots its own backend via e2e/contract/fixtures.ts
  // and isn't in test:contract's own file list (http.spec.ts + ws.spec.ts only), so it's run
  // explicitly here rather than assumed covered.
  ['golden-turn',     'npm run e2e:golden-turn'],
  // TAU-6: the Tauri-shell golden smoke (e2e/golden-tauri/), mirroring e2e/golden's Electron one
  // but attached over CDP (WebView2 speaks it; see e2e/golden-tauri/fixtures.ts's header comment
  // for why the tauri-driver/WDIO fallback wasn't needed). Requires tauri/target/debug/app.exe to
  // already be built (`cd tauri && cargo build`); this step doesn't build it, same as
  // golden/golden-turn not building their own packaged app / backend from scratch.
  ['golden-tauri',    'npm run e2e:golden:tauri'],
  // ENG-3: settings-store parity (Python vs the TS engine reading the same seeded settings.json,
  // legacy-key migration included) + a real single-writer round trip through the engine's live
  // /api/settings HTTP endpoint, confirmed still readable by Python with the ownership flag
  // unset. Requires `cd engine && npm run build` to already be current, same as the contract
  // steps above.
  ['settings-parity', 'node scripts/check-settings-parity.mjs'],
  // ENG-6: the 9Router supervision port's own ported vitest suite (engine/src/router/*.test.ts --
  // watchdog/death-watcher, Windows ACL hardening, and the sync orphan-sweep guards, 1:1 against
  // backend/tests/test_router_{watchdog,sync_guards,data_dir_permissions}.py and
  // backend/apps/nine_router/tests/test_process.py). Scoped to src/router/ deliberately, not the
  // whole `npm run engine:test` suite: engine/src/browser/** is concurrent BRW work-in-progress
  // with its own pre-existing failures unrelated to this check (see docs/plans/txm-status.md's
  // Phase BRW note) -- this step should go red only for a regression in the 9Router port itself.
  ['engine-router-tests', 'npm --prefix engine exec -- vitest run src/router'],
  // ENG-7: health/service native port + the provider-egress compliance chokepoint. lint/typecheck/
  // test run across the WHOLE engine/ tree (not scoped like engine-router-tests above) because the
  // egress ESLint rule (engine/eslint.config.mjs) and its ESLint-config-sanity check
  // (check-provider-egress.mjs, below) are meant to hold everywhere in engine/src, not just this
  // ticket's own files -- confirmed clean end-to-end against ENG-3/ENG-6/BRW's concurrently-landed
  // files as of this ticket, not just the files this ticket authored.
  ['engine-lint',        'npm --prefix engine run lint'],
  ['engine-typecheck',   'npm --prefix engine run typecheck'],
  ['engine-test',        'npm --prefix engine test'],
  // Belt-and-suspenders re-verification that the lint rule above is actually configured (not
  // quietly disabled) plus an independent source scan -- see the script's own header for why this
  // is deliberately not "either the lint rule or this, alone".
  ['provider-egress',    'node scripts/check-provider-egress.mjs'],
];
let failed = [];
for (const [name, cmd] of steps){
  console.log(`\n=== ${name} ===`);
  try { execSync(cmd, { stdio:'inherit', shell:true }); }
  catch { failed.push(name); }
}
// Same call-home warning as scripts/verify.mjs: fails the step but doesn't block the rest of
// the gate from running, so a report shows every failure in one pass.
try { console.log('\n=== call-home ==='); execSync('node scripts/check-callhome.mjs', { stdio:'inherit' }); }
catch { failed.push('call-home'); }
// Fork drift is a HARD failure, same as in scripts/verify.mjs — see docs/UPSTREAM.md.
try { console.log('\n=== fork-drift ==='); execSync('node scripts/check-fork-drift.mjs', { stdio:'inherit' }); }
catch { failed.push('fork-drift'); }
// i18n parity may not exist yet depending on how far the migration has landed; skip rather than
// invent a stub if it isn't there.
const i18nCheck = path.join(process.cwd(), 'scripts', 'check-i18n-parity.mjs');
if (existsSync(i18nCheck)) {
  try { console.log('\n=== i18n-parity ==='); execSync('node scripts/check-i18n-parity.mjs', { stdio:'inherit' }); }
  catch { failed.push('i18n-parity'); }
} else {
  console.log('\n=== i18n-parity === SKIPPED (scripts/check-i18n-parity.mjs does not exist yet)');
}
if (failed.length){ console.error(`\nVERIFY:NEXT FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\nVERIFY:NEXT GREEN');

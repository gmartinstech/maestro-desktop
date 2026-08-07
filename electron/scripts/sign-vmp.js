// Cross-platform wrapper around sign-vmp.sh.
// VMP signing (CastLabs Widevine) only runs on macOS. On Windows/Linux this
// is a no-op so `npm install` doesn't blow up trying to invoke bash.
const { spawnSync } = require('child_process');
const path = require('path');

// Detached fork: VMP (CastLabs Widevine) signing needs an EVS account we don't have.
// Skip unless a signed-release path explicitly opts in via VMP_REQUIRE_SIGN=1, so a
// plain `npm install` never requires EVS credentials.
if (process.env.VMP_REQUIRE_SIGN !== '1') {
  console.log('[vmp] Skipping VMP signing (VMP_REQUIRE_SIGN != 1)');
  process.exit(0);
}

if (process.platform !== 'darwin') {
  console.log(`[vmp] Skipping VMP signing on ${process.platform} (macOS-only)`);
  process.exit(0);
}

const script = path.join(__dirname, 'sign-vmp.sh');
const result = spawnSync('bash', [script], { stdio: 'inherit' });
process.exit(result.status ?? 0);

// engine/src/settings/credentialStore.integration-check.ts -- ENG-4's own gate: not part of the
// vitest suite (which stays fully mocked, see credentialStore.test.ts), because the whole point
// here is to hit the REAL OS credential store and the REAL Python implementation side by side.
// Run with: npx tsx src/settings/credentialStore.integration-check.ts
//
// Proves two things:
//   (A) READ-COMPAT against the REAL production entry: using the ACTUAL exported
//       loadRefreshToken() (no injected fakes), whatever it reads for
//       MAESTRO_KEYRING_SERVICE/MAESTRO_KEYRING_USERNAME matches, byte for byte, whatever
//       `python -c` calling keyring.get_password(...) reads, at the same moment -- this is the
//       ticket's literal migration concern ("the TS reader MUST read that exact same OS-keyring
//       entry"). Read-only: never writes to the real entry.
//   (B) WRITE-INTEROP, both directions, against a DEDICATED SCRATCH service name (see SAFETY
//       below for why this can't reuse the public storeRefreshToken/loadRefreshToken, which are
//       hardcoded to the real constants by design): a value written by this module's exact
//       primary-target write mechanism is read back correctly by Python's own
//       keyring.get_password(), and a value written by Python's keyring.set_password() is read
//       back correctly by this module's exact safe primary-target read mechanism.
//
// SAFETY -- why (B) does NOT use the real MAESTRO_KEYRING_SERVICE/MAESTRO_KEYRING_USERNAME entry:
// this dev box has other concurrent ticket workflows genuinely running a live backend against that
// SAME real credential entry right now (confirmed via `Get-Process` showing multiple long-running
// backend/.venv python.exe processes started well before this check runs, AND empirically: a probe
// value written to the real entry was observed read back as empty moments later by a fresh,
// independent read). Round-tripping through the real entry under an active race would produce a
// flaky, misleading gate result and risks clobbering another session's real sign-in state. (B)
// instead exercises the IDENTICAL mechanism credentialStore.ts's osKeyringSet/winGetPassword use
// (Entry.withTarget with target=service on Windows, matching WinVaultKeyring's own primary-target
// convention, plus the same P/Invoke-based safe read on the read side; a plain Entry(service,
// username) elsewhere) against an isolated, uncontested scratch service name, so the interop proof
// is real and deterministic without touching contested production state. (A) above already covers
// the real entry directly, read-only, where no race is possible.
//
// A SEPARATE, ALREADY-FIXED FINDING FROM THIS CHECK'S OWN DEVELOPMENT (left here for the next
// reader): earlier verification against the real entry (and, reproduced again against throwaway
// scratch services) surfaced that @napi-rs/keyring's own READ calls (Entry.getPassword() /
// Entry.getSecret()) DESTRUCTIVELY ZERO OUT a Windows credential written by any other tool
// (confirmed against both Python's pywin32 and the native `cmdkey` command) -- not a decode
// failure, an actual write-back-empty side effect of what looks like a read. Writes (setPassword)
// and deletes (deletePassword) were separately confirmed NOT to share this problem, including a
// setPassword that overwrites an existing foreign-written entry. credentialStore.ts's own module
// doc has the full writeup and the fix (a P/Invoke-based safe reader on Windows, mirrored below
// for the scratch service so this check never calls the unsafe path either).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME, loadRefreshToken } from './credentialStore';

// engine/src/settings -> engine/src -> engine -> repo root, same pattern as auth/token.ts's own
// P_REPO_ROOT (computed independently here to keep this a standalone manual-check script, matching
// this repo's other *.integration-check.ts files).
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..');
const P_PYTHON = resolve(P_REPO_ROOT, 'backend', '.venv', 'Scripts', 'python.exe');

// Isolated from the real MAESTRO_KEYRING_SERVICE on purpose -- see SAFETY above. Same account
// name as the real pair so the Windows primary/compound target-name mechanics stay identical.
const P_SCRATCH_SERVICE = 'MaestroStudioEng4InteropCheck';

// A sentinel distinguishing "the real keyring.get_password() call returned None" from "returned
// an empty string" when read back through python -c's stdout (both would otherwise print as an
// empty line) -- printed by the python snippet in both cases so this script can tell them apart
// exactly the way the Python module itself distinguishes None from "".
const P_NONE_SENTINEL = '__MAESTRO_NONE__';

function pythonGet(service: string, username: string): string | null {
  const out = execFileSync(
    P_PYTHON,
    ['-c', `import keyring\nv = keyring.get_password(${JSON.stringify(service)}, ${JSON.stringify(username)})\nprint(v if v is not None else ${JSON.stringify(P_NONE_SENTINEL)})`],
    { encoding: 'utf8' },
  );
  const trimmed = out.replace(/\r?\n$/, '');
  return trimmed === P_NONE_SENTINEL ? null : trimmed;
}

function pythonSet(service: string, username: string, value: string): void {
  execFileSync(P_PYTHON, ['-c', `import keyring\nkeyring.set_password(${JSON.stringify(service)}, ${JSON.stringify(username)}, ${JSON.stringify(value)})`]);
}

function pythonDelete(service: string, username: string): void {
  execFileSync(P_PYTHON, [
    '-c',
    `import keyring\ntry:\n    keyring.delete_password(${JSON.stringify(service)}, ${JSON.stringify(username)})\nexcept keyring.errors.PasswordDeleteError:\n    pass`,
  ]);
}

// Mirrors credentialStore.ts's own osKeyringSet mechanism exactly (primary, service-only
// TargetName on Windows via Entry.withTarget; a plain Entry(service, username) elsewhere),
// parameterized by service so it can target the scratch pair instead of the real one. SET was
// verified safe against foreign-written entries (see module doc), so no P/Invoke workaround is
// needed on this side.
function tsScratchSet(service: string, username: string, value: string): void {
  // Matches credentialStore.ts's own lazy-require rationale (documented there); this script only
  // ever runs manually, with the real native binding installed, so no fallback path is needed here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Entry } = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  if (process.platform === 'win32') {
    Entry.withTarget(service, service, username).setPassword(value);
  } else {
    new Entry(service, username).setPassword(value);
  }
}

// Mirrors credentialStore.ts's own winCredRead/decodeCredentialBlob mechanism exactly (see that
// module's CRITICAL, VERIFIED FINDING) -- the safe P/Invoke read, never the destructive
// @napi-rs/keyring read, parameterized by service so it can target the scratch pair.
const P_CRED_READ_CS = `
using System;
using System.Runtime.InteropServices;
public class MaestroCredManagerCheck {
    [StructLayout(LayoutKind.Sequential)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr CredentialPtr);
    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);
}
`.trim();

function tsScratchGet(service: string, username: string): string | null {
  if (process.platform !== 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Entry } = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    return new Entry(service, username).getPassword();
  }
  const escaped = service.replace(/'/g, "''");
  const script = [
    `Add-Type -TypeDefinition @'`,
    P_CRED_READ_CS,
    `'@`,
    `$ptr = [IntPtr]::Zero`,
    `$ok = [MaestroCredManagerCheck]::CredRead('${escaped}', 1, 0, [ref]$ptr)`,
    `if (-not $ok) { Write-Output 'NOTFOUND'; exit 0 }`,
    `$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][MaestroCredManagerCheck+CREDENTIAL])`,
    `$blobBytes = New-Object byte[] $cred.CredentialBlobSize`,
    `if ($cred.CredentialBlobSize -gt 0) { [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blobBytes, 0, $cred.CredentialBlobSize) }`,
    `[MaestroCredManagerCheck]::CredFree($ptr)`,
    `Write-Output 'FOUND'`,
    `Write-Output ([Convert]::ToBase64String($blobBytes))`,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8' });
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines[0] !== 'FOUND') return null;
  const blob = Buffer.from(lines[1] ?? '', 'base64');
  if (blob.length === 0) return '';
  try {
    return new TextDecoder('utf-16le', { fatal: true }).decode(blob);
  } catch {
    return blob.toString('utf8');
  }
}

async function main(): Promise<void> {
  // --- (A) READ-COMPAT against the REAL production entry (read-only, no race possible) ---
  console.log(`[integration-check] (A) service=${JSON.stringify(MAESTRO_KEYRING_SERVICE)} username=${JSON.stringify(MAESTRO_KEYRING_USERNAME)}`);
  const pythonValue = pythonGet(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME);
  const tsValue = loadRefreshToken();
  console.log(`[integration-check] (A) python keyring.get_password(...) = ${pythonValue === null ? 'None' : `"${pythonValue.length} chars"`}`);
  console.log(`[integration-check] (A) TS      loadRefreshToken()      = ${tsValue === null ? 'null' : `"${tsValue.length} chars"`}`);
  if (pythonValue !== tsValue) {
    throw new Error(`(A) READ-COMPAT FAILED: python read ${JSON.stringify(pythonValue)}, TS read ${JSON.stringify(tsValue)} -- these must be byte-identical (same OS-keyring entry).`);
  }
  const scenario =
    pythonValue !== null && pythonValue.length > 0
      ? 'a REAL non-empty credential existed on this machine at the moment of this read'
      : "no real non-empty credential was present at the moment of this read (python itself read null/empty -- see this file's SAFETY note on the shared, actively-used dev box)";
  console.log(`[integration-check] (A) PASS -- scenario tested: ${scenario}.`);

  // --- (B) WRITE-INTEROP, both directions, against the isolated scratch pair (see SAFETY above) ---
  console.log(`[integration-check] (B) scratch service=${JSON.stringify(P_SCRATCH_SERVICE)} username=${JSON.stringify(MAESTRO_KEYRING_USERNAME)} (NOT the real production entry)`);
  try {
    const probe1 = `eng4-ts-to-py-probe-${Date.now()}`;
    console.log(`[integration-check] (B1) writing ${JSON.stringify(probe1)} via TS's exact primary-target write mechanism...`);
    tsScratchSet(P_SCRATCH_SERVICE, MAESTRO_KEYRING_USERNAME, probe1);
    const readByPython = pythonGet(P_SCRATCH_SERVICE, MAESTRO_KEYRING_USERNAME);
    if (readByPython !== probe1) {
      throw new Error(`(B1) WRITE-INTEROP (TS->Python) FAILED: wrote ${JSON.stringify(probe1)} via TS, python read back ${JSON.stringify(readByPython)}`);
    }
    console.log('[integration-check] (B1) PASS -- python reads back exactly what TS wrote.');

    const probe2 = `eng4-py-to-ts-probe-${Date.now()}`;
    console.log(`[integration-check] (B2) keyring.set_password(..., ${JSON.stringify(probe2)}) via python -c...`);
    pythonSet(P_SCRATCH_SERVICE, MAESTRO_KEYRING_USERNAME, probe2);
    const readByTs = tsScratchGet(P_SCRATCH_SERVICE, MAESTRO_KEYRING_USERNAME);
    if (readByTs !== probe2) {
      throw new Error(`(B2) WRITE-INTEROP (Python->TS) FAILED: wrote ${JSON.stringify(probe2)} via python, TS read back ${JSON.stringify(readByTs)}`);
    }
    console.log('[integration-check] (B2) PASS -- TS (via the same safe read mechanism credentialStore.ts uses) reads back exactly what python wrote.');
  } finally {
    console.log('[integration-check] cleaning up the scratch credential entry...');
    pythonDelete(P_SCRATCH_SERVICE, MAESTRO_KEYRING_USERNAME);
  }

  console.log('[integration-check] DONE -- (A) real-entry read-compat and (B) bidirectional write-interop both passed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[integration-check] FAILED', err);
    process.exit(1);
  });

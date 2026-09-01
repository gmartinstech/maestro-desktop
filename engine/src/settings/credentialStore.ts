// engine/src/settings/credentialStore.ts -- ENG-4, the OS credential store for the Keycloak
// refresh token, ported from backend/apps/settings/maestro_credential_store.py.
//
// CRITICAL MIGRATION CONCERN (this ticket's own hard constraint): MAESTRO_KEYRING_SERVICE and
// MAESTRO_KEYRING_USERNAME below are copied byte-for-byte from
// backend/apps/settings/maestro_credential_store.py lines 26-27:
//   MAESTRO_KEYRING_SERVICE = "MaestroStudio"
//   MAESTRO_KEYRING_USERNAME = "keycloak-refresh-token"
// This engine MUST read/write the exact same OS-keyring entry Python has been using since
// launch -- a different service/account name (or a different on-disk encoding of the same pair,
// see the Windows section below) silently logs out every existing user the first time this
// engine runs instead of Python.
//
// PRIMARY BACKEND: @napi-rs/keyring (a prebuilt native N-API binding -- no node-gyp/Rust toolchain
// needed at install time, unlike keytar which also compiles from source AND is unmaintained; the
// ticket for this ENG phase explicitly bans keytar as a dependency). It wraps the same hwchen
// keyring-rs crate whose backends target the identical OS stores Python's `keyring` package
// targets (Windows Credential Manager / macOS Keychain / Linux Secret Service), so this is a
// same-store port, not a new, separate credential silo.
//
// WINDOWS TARGET-NAME QUIRK (verified empirically against this repo's own Windows dev box, not
// assumed from docs): @napi-rs/keyring's plain `new Entry(service, username)` constructor writes
// Windows Credential Manager entries under TargetName="{username}.{service}" (confirmed via
// `cmdkey /list` after a throwaway write). Python's keyring.backends.Windows.WinVaultKeyring
// (backend/.venv/Lib/site-packages/keyring/backends/Windows.py) does something DIFFERENT: it
// writes the credential directly under TargetName="{service}" (no username segment at all), and
// only falls back to a compound TargetName="{username}@{service}" (note: "@", not ".") on a
// same-service/different-username collision -- see that file's own WinVaultKeyring docstring.
// These are three different strings ("username.service" vs "service" vs "username@service"); a
// naive `new Entry(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME)` on Windows would silently
// miss the real Python-written entry entirely (confirmed: it read back `null` against a real
// token this repo's Python side had genuinely stored). Entry.withTarget(target, service, username)
// lets this module pin the EXACT TargetName Python actually uses instead of trusting the
// binding's own differently-shaped default.
//
// CRITICAL, VERIFIED FINDING -- @napi-rs/keyring's READ on Windows is DESTRUCTIVE against an entry
// written by any OTHER tool (confirmed against both Python's pywin32-ctypes CredWrite and the
// Windows-native `cmdkey` command): calling Entry.getPassword() OR the lower-level Entry.getSecret()
// on such an entry does not merely fail to decode it -- immediately after that call returns, a
// completely independent, fresh `python -c` process's own win32cred.CredRead on the SAME
// TargetName observes CredentialBlobSize collapse to 0. The credential is not just misread, it is
// zeroed out at rest, in the real Windows Credential Manager store, as an observable side effect of
// what looks like a read. Writes (setPassword) and deletes (deletePassword) were separately
// confirmed NOT to share this problem, including a setPassword that overwrites an existing
// foreign-written entry (verified: python written -> napi-rs setPassword -> fresh python re-read
// sees the NEW value intact) and a deletePassword against a foreign-written entry (verified: fresh
// python re-read afterward sees None, a real delete, not a zeroing). Only the read path is unsafe.
// This is exactly the migration hazard this ticket warns about, one level worse than described:
// naively wiring Entry.getPassword() up as the read path would not just risk missing an existing
// user's refresh token on the first engine run, it would DESTROY it in the OS store the moment
// loadRefreshToken() is called, logging that user out with no way back short of a fresh Keycloak
// sign-in. (This finding cost a real, if low-stakes, credential on this repo's own dev box during
// verification -- see this ticket's own gate notes.)
//
// WORKAROUND (Windows only): reads never go through @napi-rs/keyring at all on win32. Instead,
// winCredRead() below shells out to `powershell.exe -EncodedCommand` running a small embedded C#
// snippet that P/Invokes the real Win32 CredReadW/CredFree pair from advapi32.dll directly --
// the exact same underlying OS API Python's pywin32 wraps, just called from .NET instead of
// Rust/N-API, with no serialization layer in between to disagree with Python's own. Verified
// non-destructive across repeated round trips (write via python, read via this mechanism twice,
// re-read via a fresh python process each time -- value survives unchanged). @napi-rs/keyring
// remains the write/delete backend everywhere (see above: confirmed safe there) and the read
// backend on every OTHER platform (macOS Keychain / Linux Secret Service are a different keyring-rs
// backend entirely, untested here but with no evidence of the same bug, and this repo has no
// non-Windows box to verify against). The PowerShell round trip costs real process-spawn latency
// (tens to a few hundred ms) on every loadRefreshToken() call on Windows -- an accepted tradeoff:
// correctness (a read that cannot zero out a real user's credential) over shaving that latency.
//
// Deliberately NOT replicated: WinVaultKeyring's write-side collision handling (moving a
// *different* username's existing primary-target credential into the compound slot before
// claiming the primary slot for this write). MAESTRO_KEYRING_USERNAME is a fixed constant only
// this module ever writes under MAESTRO_KEYRING_SERVICE, so a same-service/different-username
// collision from this app's own writes cannot occur. Read-side, winCredRead's UserName check (see
// below) means this module DOES still correctly fall through to the compound target when the
// primary target's stored username doesn't match, mirroring WinVaultKeyring._resolve_credential
// exactly (something the old napi-rs-based read could not do at all, since Entry.getPassword()
// never exposes the stored UserName -- one more reason the safe P/Invoke path is strictly better
// here, not merely a workaround).
//
// FALLBACK BACKEND: an encrypted file under resolveDataRoot()/credentials, used ONLY when the OS
// keyring itself is unreachable (native binding failed to load -- no prebuilt binary for this
// platform/arch, a headless container, a sandboxed environment with no OS keyring service
// running, etc.), not merely "no entry stored yet" (that's a normal, valid "no token" answer from
// a reachable keyring, and must NOT fall through to the file -- see loadRefreshToken). This is
// forward-looking scaffolding for a later remote/mobile phase where no OS keyring exists at all;
// it is exercised today whenever the primary backend can't load.
//
// THREAT MODEL of the file fallback (read this before trusting it for anything more sensitive):
// the key is derived (scrypt) from a per-machine, per-account fingerprint (hostname + OS username
// + platform) plus a random salt stored in PLAINTEXT right next to the ciphertext. This defends
// against exactly one thing: a token that ends up somewhere it shouldn't via casual copying of
// the plaintext bytes alone -- e.g. the same worry Python's own module doc raises about
// settings.json "already leav[ing] the machine in a support .swarm bundle": grepping a copied
// data directory, or a support bundle upload, no longer hands over the raw token string. It does
// NOT defend against anything with the fingerprint inputs and the salt file together, which is
// exactly what anyone who also has filesystem access to this data directory has: the key is
// trivially recomputable, so this is at-rest OBFUSCATION against passive disclosure, not a real
// secrecy boundary against another process/user on the same machine, a local admin, or anyone who
// captures the whole data directory (salt included) rather than just the token in isolation. Real
// secrecy against a co-resident attacker needs an actual OS keyring (this module's own primary
// path) or hardware-backed storage; this fallback exists so a headless install still has SOME
// bar in place, not to claim keyring-equivalent protection.

import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { resolveDataRoot } from '../auth/token';
import { atomicWriteJson } from './store';

// Copied byte-for-byte from backend/apps/settings/maestro_credential_store.py lines 26-27 -- see
// this file's own module doc for why these two strings must never change.
export const MAESTRO_KEYRING_SERVICE = 'MaestroStudio';
export const MAESTRO_KEYRING_USERNAME = 'keycloak-refresh-token';

// The napi-rs Entry surface this module actually calls -- kept narrow (not the package's full
// typings) so the test-only injection hook below can swap in a plain in-memory fake with no
// native binding involved at all, the same "swap the real dependency for an in-memory fake"
// convention backend/tests/test_maestro_credential_store.py's own fake_keyring fixture uses.
interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}
interface KeyringModule {
  Entry: {
    new (service: string, username: string): KeyringEntry;
    withTarget(target: string, service: string, username: string): KeyringEntry;
  };
}

// Lazily `require`d (not a top-level `import`) so a platform/arch with no prebuilt
// @napi-rs/keyring-* binary available -- headless CI, an unsupported architecture, a sandbox that
// blocks native addons -- fails ONLY this load, not the whole module's import, letting every
// caller fall through to the encrypted-file backend below instead of crashing the engine.
let cachedKeyringModule: KeyringModule | null | undefined;

function loadKeyringModule(): KeyringModule | null {
  if (cachedKeyringModule !== undefined) return cachedKeyringModule;
  try {
    // Must stay a lazy, catchable require, not a static import -- see comment above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedKeyringModule = require('@napi-rs/keyring') as KeyringModule;
  } catch {
    cachedKeyringModule = null;
  }
  return cachedKeyringModule;
}

// Test-only escape hatch: swaps in an in-memory fake (or null, to simulate "native binding
// unavailable") without touching the real OS credential store. Not used by any runtime path.
// Mirrors auth/token.ts's resetAuthTokenForTests / auth/scrubber.ts's resetTokenScrubberForTests.
export function setKeyringModuleForTests(mod: KeyringModule | null): void {
  cachedKeyringModule = mod;
}
export function resetKeyringModuleForTests(): void {
  cachedKeyringModule = undefined;
}

function compoundTarget(): string {
  return `${MAESTRO_KEYRING_USERNAME}@${MAESTRO_KEYRING_SERVICE}`;
}

// --- Windows-only safe credential read (see module doc's CRITICAL, VERIFIED FINDING) ---

interface WinCredResult {
  blob: Buffer;
  userName: string;
}

// A small, self-contained P/Invoke shim: declares just the two advapi32.dll entry points this
// module needs (CredReadW to fetch the credential, CredFree to release it), nothing else.
const P_CRED_READ_CS = `
using System;
using System.Runtime.InteropServices;
public class MaestroCredManager {
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

// target is always MAESTRO_KEYRING_SERVICE or the compound name built from it just above -- never
// external/user input -- but the single-quote escape below is kept anyway for correctness, not
// because untrusted input is expected to reach this function.
function buildCredReadScript(target: string): string {
  const escaped = target.replace(/'/g, "''");
  return [
    `Add-Type -TypeDefinition @'`,
    P_CRED_READ_CS,
    `'@`,
    `$ptr = [IntPtr]::Zero`,
    `$ok = [MaestroCredManager]::CredRead('${escaped}', 1, 0, [ref]$ptr)`,
    `if (-not $ok) { Write-Output 'NOTFOUND'; exit 0 }`,
    `$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][MaestroCredManager+CREDENTIAL])`,
    `$blobBytes = New-Object byte[] $cred.CredentialBlobSize`,
    `if ($cred.CredentialBlobSize -gt 0) { [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blobBytes, 0, $cred.CredentialBlobSize) }`,
    `$userName = if ($cred.UserName -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.UserName) } else { '' }`,
    `[MaestroCredManager]::CredFree($ptr)`,
    `Write-Output 'FOUND'`,
    `Write-Output $userName`,
    `Write-Output ([Convert]::ToBase64String($blobBytes))`,
  ].join('\n');
}

// The REAL Windows Credential Manager reader (see module doc: -EncodedCommand carries the script
// as UTF-16LE base64, sidestepping every cmd.exe/PowerShell quoting hazard entirely -- there is no
// shell-escaping of `target` to get wrong). Returns null for "no such credential"; throws on any
// other failure (powershell.exe missing, unexpected output shape) so the caller can fall back to
// the encrypted file, matching every other "OS store unreachable" path in this module.
function realWinCredRead(target: string): WinCredResult | null {
  const script = buildCredReadScript(target);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8' });
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines[0] !== 'FOUND') return null;
  return { userName: lines[1] ?? '', blob: Buffer.from(lines[2] ?? '', 'base64') };
}

// Test-only injection seam -- lets credentialStore.test.ts exercise the primary/compound/username
// resolution logic in winGetPassword() below with a plain in-memory fake, never actually spawning
// powershell.exe (or touching a real credential) from the fast unit suite. Not used by any runtime
// path. Mirrors this module's own setKeyringModuleForTests.
let winCredReadImpl: (target: string) => WinCredResult | null = realWinCredRead;
export function setWinCredReaderForTests(fn: ((target: string) => WinCredResult | null) | null): void {
  winCredReadImpl = fn ?? realWinCredRead;
}
export function resetWinCredReaderForTests(): void {
  winCredReadImpl = realWinCredRead;
}

// Mirrors Python's DecodingCredential.value exactly: Windows Credential Manager blobs are
// conventionally UTF-16LE text (what CredWrite's callers, pywin32 included, actually write); try
// that first with strict (fatal) decoding, falling back to UTF-8 only if the bytes aren't valid
// UTF-16LE (e.g. an odd byte count, or an unpaired surrogate).
function decodeCredentialBlob(bytes: Buffer): string {
  if (bytes.length === 0) return '';
  try {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

// Mirrors WinVaultKeyring._resolve_credential's read order AND its username check (something the
// old napi-rs-based read could not do at all -- see module doc): the primary target only counts as
// a match if its stored UserName equals MAESTRO_KEYRING_USERNAME; otherwise (or if the primary is
// entirely absent) fall through to the compound target under the same check.
function winGetPassword(): string | null {
  const primary = winCredReadImpl(MAESTRO_KEYRING_SERVICE);
  if (primary && primary.userName === MAESTRO_KEYRING_USERNAME) return decodeCredentialBlob(primary.blob);
  const compound = winCredReadImpl(compoundTarget());
  if (compound && compound.userName === MAESTRO_KEYRING_USERNAME) return decodeCredentialBlob(compound.blob);
  return null;
}

// Returns undefined when the OS keyring itself could not be reached at all (native binding/reader
// missing, or the underlying call threw) -- the caller falls through to the file backend only in
// that case. A reachable keyring's own null/string answer is authoritative and returned as-is.
function osKeyringGet(): string | null | undefined {
  if (process.platform === 'win32') {
    try {
      return winGetPassword();
    } catch {
      return undefined;
    }
  }
  const mod = loadKeyringModule();
  if (!mod) return undefined;
  try {
    return new mod.Entry(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).getPassword();
  } catch {
    return undefined;
  }
}

// Returns true once the OS keyring accepted the write (so the caller skips the file fallback);
// false for "OS keyring unreachable, use the file fallback instead." Never throws.
function osKeyringSet(token: string): boolean {
  const mod = loadKeyringModule();
  if (!mod) return false;
  try {
    // Always the primary (service-only) target -- see module doc on why the write-side collision
    // dance is deliberately not replicated here.
    const target = process.platform === 'win32' ? MAESTRO_KEYRING_SERVICE : null;
    if (target !== null) {
      mod.Entry.withTarget(target, MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).setPassword(token);
    } else {
      new mod.Entry(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).setPassword(token);
    }
    return true;
  } catch {
    return false;
  }
}

// Best-effort clear of both the primary and (Windows-only) compound targets. Never throws --
// deletePassword() itself returns false rather than throwing for "nothing to delete" (per
// @napi-rs/keyring's own contract), and any other failure is swallowed here the same way Python's
// clear_refresh_token swallows every exception except the expected "already absent" case.
function osKeyringClear(): void {
  const mod = loadKeyringModule();
  if (!mod) return;
  try {
    if (process.platform === 'win32') {
      try {
        mod.Entry.withTarget(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).deletePassword();
      } catch {
        // non-fatal, matches Python's swallow-and-log posture
      }
      try {
        mod.Entry.withTarget(compoundTarget(), MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).deletePassword();
      } catch {
        // non-fatal -- this target may simply never have existed
      }
      return;
    }
    new mod.Entry(MAESTRO_KEYRING_SERVICE, MAESTRO_KEYRING_USERNAME).deletePassword();
  } catch {
    // non-fatal, matches Python's swallow-and-log posture
  }
}

// --- Encrypted-file fallback (see THREAT MODEL in the module doc above) ---

const P_FALLBACK_ALGO = 'aes-256-gcm';
const P_FALLBACK_VERSION = 1;

interface FallbackPayload {
  v: number;
  salt: string; // base64
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

function fallbackFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'credentials', 'keycloak-refresh-token.enc.json');
}

// A per-machine, per-account fingerprint -- deliberately NOT a secret (see THREAT MODEL above);
// it only needs to be stable across runs on the same install, not unguessable.
function fallbackKeyMaterial(): string {
  let username = 'unknown-user';
  try {
    username = userInfo().username;
  } catch {
    // userInfo() can throw in some restricted/containerized environments -- fall back to the
    // fixed placeholder rather than letting the whole credential store blow up over it.
  }
  return `${hostname()}::${username}::${process.platform}`;
}

function deriveFallbackKey(salt: Buffer): Buffer {
  return scryptSync(fallbackKeyMaterial(), salt, 32);
}

function encryptFallback(token: string): FallbackPayload {
  const salt = randomBytes(16);
  const key = deriveFallbackKey(salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(P_FALLBACK_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: P_FALLBACK_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptFallback(payload: FallbackPayload): string | null {
  try {
    const key = deriveFallbackKey(Buffer.from(payload.salt, 'base64'));
    const decipher = createDecipheriv(P_FALLBACK_ALGO, key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Corrupt file, wrong-machine key (fingerprint changed), or tampered ciphertext (GCM auth tag
    // check fails) -- all treated the same as "no usable value", never thrown.
    return null;
  }
}

function isFallbackPayload(v: unknown): v is FallbackPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.salt === 'string' && typeof p.iv === 'string' && typeof p.tag === 'string' && typeof p.ciphertext === 'string';
}

function fileGet(env: NodeJS.ProcessEnv): string | null {
  const path = fallbackFilePath(env);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isFallbackPayload(raw)) return null;
    return decryptFallback(raw);
  } catch {
    return null;
  }
}

function fileSet(token: string, env: NodeJS.ProcessEnv): void {
  atomicWriteJson(fallbackFilePath(env), encryptFallback(token));
}

function fileClear(env: NodeJS.ProcessEnv): void {
  try {
    unlinkSync(fallbackFilePath(env));
  } catch {
    // absent-is-fine, matches every other clear path in this module
  }
}

// --- Public API -- mirrors maestro_credential_store.py's three functions ---

// Persist the Keycloak refresh token. Prefers the OS keyring; falls back to the encrypted file
// only when the OS keyring itself could not be reached. Never raises the token itself on failure.
export function storeRefreshToken(token: string, env: NodeJS.ProcessEnv = process.env): void {
  if (osKeyringSet(token)) {
    // The OS keyring now holds the current value -- drop any stale fallback-file copy left over
    // from an earlier run where the keyring was unreachable, so a later "keyring unreachable
    // again" read never resurrects an out-of-date token instead of the current one.
    fileClear(env);
    return;
  }
  try {
    fileSet(token, env);
  } catch (e) {
    console.warn(`[engine] credentialStore: failed to persist the Maestro refresh token (OS keyring unreachable, file fallback also failed): ${(e as Error).message}`);
  }
}

// The stored refresh token, or null when there is none (fresh install, cleared, or every backend
// errored). A reachable OS keyring's own answer (string or null) is authoritative and is never
// second-guessed against the file fallback -- see osKeyringGet's own doc.
export function loadRefreshToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromKeyring = osKeyringGet();
  if (fromKeyring !== undefined) return fromKeyring;
  return fileGet(env);
}

// Drop the stored refresh token (sign-out) from BOTH backends unconditionally -- not just
// whichever one currently holds the value -- so no stale copy of a cleared token survives a
// keyring-availability change across runs. A no-op, not an error, when nothing was stored.
export function clearRefreshToken(env: NodeJS.ProcessEnv = process.env): void {
  osKeyringClear();
  fileClear(env);
}

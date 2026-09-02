// engine/src/apps/outputs/runtimeLedger.ts -- SUB-5, a full port of backend/apps/outputs/
// runtime_ledger.py: cross-boot ownership ledger for app runtimes, plus the boot-time orphan
// reaper. See the Python module doc for the full ownership-rule rationale (reap ONLY when the
// owning backend is dead AND the recorded pid is still alive AND still runs the recorded image
// name; any unanswerable probe resolves to "not an orphan").

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from '../../settings/store';
import { resolveDataRoot } from '../../auth/token';
import { killDescendantTree, killListenerOnPort } from './runtimeProc';

function ledgerPath(env: NodeJS.ProcessEnv): string {
  return join(resolveDataRoot(env), 'app_runtimes.json');
}
function ownersDir(env: NodeJS.ProcessEnv): string {
  return join(resolveDataRoot(env), 'app_runtime_owners');
}

// Regenerated per engine process; pairs with our pid in the owner file so a recycled pid can
// never impersonate a previous boot.
export const BOOT_ID = randomUUID().replace(/-/g, '');

export interface RuntimeRecord {
  pid: number;
  workspace_id: string;
  instance: number;
  image: string;
  frontend_port: number | null;
  owner_pid: number;
  owner_boot_id: string;
  started_at: string;
}

export interface RuntimeLedgerFile {
  records: RuntimeRecord[];
}

function readJsonOrNull(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function windowsTool(name: string): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const candidate = join(root, 'System32', `${name}.exe`);
  return existsSync(candidate) ? candidate : name;
}

/** True when a process with this pid currently exists. */
export function pidAlive(pid: number): Promise<boolean> {
  if (pid <= 0) return Promise.resolve(false);
  if (process.platform === 'win32') {
    return processImage(pid).then((img) => img !== '');
  }
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') return Promise.resolve(false);
    if (err.code === 'EPERM') return Promise.resolve(true); // exists, belongs to another user
    return Promise.resolve(false);
  }
}

/** Lowercased executable/image name for `pid`, or "" when it cannot be determined. The empty
 * return is load-bearing: isOrphan refuses to kill anything whose image it cannot read. */
export function processImage(pid: number): Promise<string> {
  if (pid <= 0) return Promise.resolve('');
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(windowsTool('tasklist'), ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve('');
        const line = (stdout || '').trim().split(/\r?\n/)[0] ?? '';
        if (!line.startsWith('"')) return resolve('');
        const image = line.split('","')[0]?.replace(/^"|"$/g, '').trim().toLowerCase() ?? '';
        resolve(image);
      });
      return;
    }
    execFile('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve('');
      const comm = (stdout || '').trim();
      const base = comm.split(/[/\\]/).pop() ?? '';
      resolve(base.toLowerCase());
    });
  });
}

function ownerFile(pid: number, env: NodeJS.ProcessEnv): string {
  return join(ownersDir(env), `${pid}.json`);
}

/** Publish our liveness marker. Call at boot BEFORE the reap. */
export function registerOwner(env: NodeJS.ProcessEnv = process.env): void {
  try {
    atomicWriteJson(ownerFile(process.pid, env), { boot_id: BOOT_ID, started_at: new Date().toISOString() });
  } catch {
    // Best-effort, matches runtime_ledger.py's own logged-and-continue.
  }
}

/** Drop our liveness marker on a clean shutdown; a crash leaves it, which is why the reaper also
 * checks the pid. */
export function unregisterOwner(env: NodeJS.ProcessEnv = process.env): void {
  try {
    unlinkSync(ownerFile(process.pid, env));
  } catch {
    // Missing file is fine.
  }
}

/** True when the backend that spawned a record still looks alive: a live pid AND an owner marker
 * whose boot_id matches the record. */
export async function isOwnerAlive(pid: number, bootId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (pid === process.pid && bootId === BOOT_ID) return true;
  const data = readJsonOrNull(ownerFile(pid, env));
  if (data === null || data.boot_id !== bootId) return false;
  return pidAlive(pid);
}

export function loadLedger(env: NodeJS.ProcessEnv = process.env): RuntimeLedgerFile {
  const data = readJsonOrNull(ledgerPath(env));
  if (data === null || !Array.isArray(data.records)) return { records: [] };
  try {
    return { records: data.records as RuntimeRecord[] };
  } catch {
    return { records: [] };
  }
}

export function saveLedger(ledger: RuntimeLedgerFile, env: NodeJS.ProcessEnv = process.env): void {
  try {
    atomicWriteJson(ledgerPath(env), ledger);
  } catch {
    // Best-effort.
  }
}

/** Claim a spawned runtime under our ownership. Best-effort: failing here only costs the ability
 * to reap this one process next boot. */
export async function recordSpawn(pid: number, workspaceId: string, instance: number, frontendPort: number | null, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const ledger = loadLedger(env);
    ledger.records = ledger.records.filter((r) => r.pid !== pid);
    ledger.records.push({
      pid,
      workspace_id: workspaceId,
      instance,
      image: await processImage(pid),
      frontend_port: frontendPort,
      owner_pid: process.pid,
      owner_boot_id: BOOT_ID,
      started_at: new Date().toISOString(),
    });
    saveLedger(ledger, env);
  } catch {
    // Best-effort.
  }
}

/** Drop a record once we have stopped the process ourselves, so the next boot has nothing to chase. */
export function forget(pid: number, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const ledger = loadLedger(env);
    const remaining = ledger.records.filter((r) => r.pid !== pid);
    if (remaining.length !== ledger.records.length) {
      ledger.records = remaining;
      saveLedger(ledger, env);
    }
  } catch {
    // Best-effort.
  }
}

export interface OrphanProbes {
  ownerAlive: (pid: number, bootId: string) => Promise<boolean>;
  pidAlive: (pid: number) => Promise<boolean>;
  imageOf: (pid: number) => Promise<string>;
}

/** The whole ownership decision, probes injected so it is testable without real processes. Every
 * unknown resolves to false; a record with no recorded image is never reaped. */
export async function isOrphan(record: RuntimeRecord, probes: OrphanProbes): Promise<boolean> {
  if (record.pid <= 0 || record.pid === process.pid) return false;
  if (!record.image) return false;
  if (await probes.ownerAlive(record.owner_pid, record.owner_boot_id)) return false;
  if (!(await probes.pidAlive(record.pid))) return false;
  return (await probes.imageOf(record.pid)) === record.image;
}

function defaultProbes(env: NodeJS.ProcessEnv): OrphanProbes {
  return {
    ownerAlive: (pid, bootId) => isOwnerAlive(pid, bootId, env),
    pidAlive: (pid) => pidAlive(pid),
    imageOf: (pid) => processImage(pid),
  };
}

/** Records this boot may kill. Probes default to the real ones; tests inject fakes. */
export async function selectOrphans(ledger: RuntimeLedgerFile, probes?: Partial<OrphanProbes>, env: NodeJS.ProcessEnv = process.env): Promise<RuntimeRecord[]> {
  const resolved = { ...defaultProbes(env), ...probes };
  const out: RuntimeRecord[] = [];
  for (const r of ledger.records) {
    if (await isOrphan(r, resolved)) out.push(r);
  }
  return out;
}

/** Delete owner markers whose pid is gone, so the dir does not accumulate one file per crash. */
async function pruneDeadOwnerMarkers(env: NodeJS.ProcessEnv): Promise<void> {
  const dir = ownersDir(env);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const pid = Number(name.slice(0, -'.json'.length));
    if (!Number.isInteger(pid)) continue;
    if (pid === process.pid || (await pidAlive(pid))) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      // Best-effort.
    }
  }
}

/** Kill every ledger record no live backend owns, and return what was killed. Boot is where this
 * runs unconditionally: nothing we spawned is running yet, so "the owner is dead" cannot mean us. */
export async function reapOrphans(kill?: (pid: number, frontendPort?: number | null) => Promise<void>, env: NodeJS.ProcessEnv = process.env): Promise<RuntimeRecord[]> {
  const killer = kill ?? (async (pid: number, frontendPort?: number | null) => {
    await killDescendantTree(pid, 'KILL');
    // Windows-only supplementary sweep -- see killListenerOnPort's own header: an orphaned
    // webapp_template runtime left by a previous crashed session has the exact same MSYS
    // fork()-emulation gap AppRuntime.stop() works around (its real vite/esbuild descendants are
    // not Win32-visible children of `pid`), so a PID-only kill leaves them squatting on the port
    // this same reap is trying to free up for the next boot.
    await killListenerOnPort(frontendPort);
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Best-effort.
      }
    }
  });
  const ledger = loadLedger(env);
  if (ledger.records.length === 0) return [];
  const orphans = await selectOrphans(ledger, undefined, env);
  const orphanPids = new Set(orphans.map((r) => r.pid));
  for (const record of orphans) {
    try {
      await killer(record.pid, record.frontend_port);
      console.log(`[outputs] reaped orphaned app runtime pid=${record.pid} workspace=${record.workspace_id} port=${record.frontend_port} (owner pid ${record.owner_pid} from a previous boot is gone)`);
    } catch (err) {
      console.error(`[outputs] failed to reap orphaned app runtime pid ${record.pid}:`, err);
    }
  }
  const survivors: RuntimeRecord[] = [];
  for (const r of ledger.records) {
    if (orphanPids.has(r.pid)) continue;
    if (await isOwnerAlive(r.owner_pid, r.owner_boot_id, env)) survivors.push(r);
  }
  ledger.records = survivors;
  saveLedger(ledger, env);
  await pruneDeadOwnerMarkers(env);
  return orphans;
}

/** Kill the dead session squatting on `port`, if the ledger says one of ours is. True when
 * something was killed, so the caller can re-probe instead of routing around the squatter. */
export async function reclaimPort(port: number, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const orphans = await selectOrphans(loadLedger(env), undefined, env);
  if (!orphans.some((r) => r.frontend_port === port)) return false;
  const reaped = await reapOrphans(undefined, env);
  return reaped.length > 0;
}

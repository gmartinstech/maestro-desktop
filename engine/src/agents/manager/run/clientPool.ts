// engine/src/agents/manager/run/clientPool.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/run/client_pool.py: per-session persistent SDK client pool (lever A
// of the TTFT work, default ON, kill switch MAESTRO_PERSISTENT_CLIENT=0). One live Claude CLI per
// session, reused across follow-up turns so the subprocess + MCP boot is paid once, not per message.
//
// Safety model, from the red-teamed plan: reuse is gated on a BOOT FINGERPRINT (a hash of every
// boot-frozen input), never on session flags. Any change to the booted config (MCPActivate growing
// mcp_servers, branch switch, compaction, provider env, selection-context system prompt) changes the
// fingerprint and forces a dispose+respawn, so "live client with stale config" is unrepresentable.
// Every error path collapses to dispose+respawn, which IS today's one-shot behavior, never worse.
//
// Generic over the pooled client shape (only `.disconnect()` is ever called on it here) -- exactly
// like the Python original's `client: InstanceOf[object]`, which never assumes a specific SDK class
// either. This keeps the pool itself decoupled from the TS Agent SDK's actual persistent-session API
// (which, per its own docs, is `query()` returning a `Query` you call `.streamInput()`/`.close()` on
// -- NOT a `ClaudeSDKClient(options).connect()`/`.query()`/`.receive_response()` trio the way the
// Python SDK's persistent client is shaped). Whichever caller wires a real SDK client in (TurnRunner
// via `pRunStreamingTurnPersistent`, not yet written into this ticket's turnRunner.ts -- see that
// file's header) is responsible for adapting the real `Query` object to `{ disconnect(): Promise<void> }`
// at the `connectFn` boundary; this file needs nothing more from it than that.

import { createHash } from 'node:crypto';
import type { AgentSession } from '../../core/models';

// Options entries that are per-turn or non-serializable; everything else is boot-frozen and hashed.
const NON_BOOT_KEYS: ReadonlySet<string> = new Set(['can_use_tool', 'stderr', 'hooks', 'resume', 'fork_session']);

export function persistentClientEnabled(): boolean {
  return process.env.MAESTRO_PERSISTENT_CLIENT !== '0';
}

/** Stable JSON stringify with recursively sorted object keys -- matches Python's
 * `json.dumps(..., sort_keys=True)` (arrays keep their order; only mapping keys are sorted). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Hash of every input the CLI subprocess freezes at boot. Includes the full mcp_servers config (so
 * MCPActivate / model-env changes respawn), the composed system prompt (so per-turn selection
 * context respawns instead of silently not applying), branch, and the compaction cutoff (else a
 * live client would keep the untrimmed transcript forever). Mirrors `boot_fingerprint` exactly. */
export function bootFingerprint(optionsKwargs: Record<string, unknown>, session: Pick<AgentSession, 'active_branch_id' | 'compacted_through_msg_id'>): string {
  const frozen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(optionsKwargs)) {
    if (!NON_BOOT_KEYS.has(k)) frozen[k] = v;
  }
  frozen.p_branch = session.active_branch_id;
  frozen.p_compacted_through = session.compacted_through_msg_id;
  const blob = stableStringify(frozen);
  return createHash('sha256').update(blob).digest('hex');
}

export interface PooledClient {
  disconnect(): Promise<void>;
}

export interface ClientHandle<C extends PooledClient = PooledClient> {
  fingerprint: string;
  client: C;
  /** Mutex serializing turns against this client -- see AsyncMutex in core/wsManager.ts for the
   * same JS analog-of-asyncio.Lock pattern this reuses conceptually (a fresh instance per handle,
   * not shared). */
  lock: AsyncLock;
  connectedAt: number;
  lastUsed: number;
  turnsServed: number;
}

/** Minimal `asyncio.Lock`-equivalent: `acquire()`/`release()` plus a `locked()` probe, and a
 * `withLock` convenience the streaming call sites use instead of manual try/finally. */
export class AsyncLock {
  private busy = false;
  private readonly waiters: Array<() => void> = [];

  locked(): boolean {
    return this.busy;
  }

  async acquire(): Promise<void> {
    if (!this.busy) {
      this.busy = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.busy = true;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand off directly to the next waiter without a spurious busy=false gap.
      next();
    } else {
      this.busy = false;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Mutable tunables, grouped on one exported object -- a bare `export let` wouldn't let external
// code (tests) observe or override it the way a Python module's globals dict does (a TS module has
// real lexical scoping); mutable fields on an exported object do, mirroring engine/src/router/
// process.ts's `routerState` convention exactly. Tests mutate `poolConfig.xyz` directly, same as
// the Python originals reassign the module attribute (e.g. `cp.IDLE_EVICT_SECONDS = 0.05`).
export const poolConfig = {
  // A pooled CLI holds ~100MB+ per session; evict clients idle past this so parked chats don't
  // accumulate subprocesses (respawn on the next message is the normal cold path).
  IDLE_EVICT_SECONDS: Number(process.env.OSW_CLIENT_IDLE_EVICT_SECONDS ?? '1800'),
  // Hard ceiling on warm CLIs regardless of idle age: past this, the least-recently-used IDLE
  // sessions are disposed. Soft cap: a mid-turn or just-acquired client is never evicted.
  MAX_LIVE_CLIENTS: Number(process.env.OSW_CLIENT_MAX_LIVE ?? '12'),
  // Never cap-evict a client used this recently; far larger than the acquire->lock window.
  LRU_GUARD_SECONDS: Number(process.env.OSW_CLIENT_LRU_GUARD_SECONDS ?? '5'),
  // Timer cadence for the background reclaim.
  SWEEP_INTERVAL_SECONDS: Number(process.env.OSW_CLIENT_SWEEP_INTERVAL_SECONDS ?? '60'),
};

function monotonicSeconds(): number {
  return performance.now() / 1000;
}

/** Dispose every handle idle past the TTL, skipping any mid-turn (lock held). Mirrors
 * `evict_idle_clients` exactly. */
export async function evictIdleClients<C extends PooledClient>(pool: Map<string, ClientHandle<C>>): Promise<void> {
  const now = monotonicSeconds();
  for (const sid of [...pool.keys()]) {
    const handle = pool.get(sid);
    if (!handle || handle.lock.locked()) continue;
    if (now - handle.lastUsed > poolConfig.IDLE_EVICT_SECONDS) {
      await disposeClient(pool, sid);
    }
  }
}

/** Dispose least-recently-used IDLE clients until the pool is back under the configured cap. Soft
 * cap: rechecks lock + recency immediately before each dispose, so a client that went mid-turn or
 * was just re-acquired is skipped and the pool temporarily exceeds the cap rather than killing live
 * work. Mirrors `trim_pool_to_cap` exactly. */
export async function trimPoolToCap<C extends PooledClient>(pool: Map<string, ClientHandle<C>>): Promise<void> {
  if (pool.size <= poolConfig.MAX_LIVE_CLIENTS) return;
  const bySid = [...pool.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [sid] of bySid) {
    if (pool.size <= poolConfig.MAX_LIVE_CLIENTS) break;
    const handle = pool.get(sid);
    if (!handle || handle.lock.locked() || monotonicSeconds() - handle.lastUsed <= poolConfig.LRU_GUARD_SECONDS) continue;
    await disposeClient(pool, sid);
  }
}

/** Return a live client whose boot matches `fingerprint`, connecting fresh when there is none, the
 * fingerprint mismatches, or the caller demands a fresh session. Mirrors `acquire_client` exactly. */
export async function acquireClient<C extends PooledClient>(
  pool: Map<string, ClientHandle<C>>,
  sessionId: string,
  fingerprint: string,
  connectFn: () => Promise<C>,
  forceRespawn = false,
): Promise<ClientHandle<C>> {
  await evictIdleClients(pool);
  const existing = pool.get(sessionId);
  if (existing) {
    if (!forceRespawn && existing.fingerprint === fingerprint) {
      existing.lastUsed = monotonicSeconds();
      return existing;
    }
    await disposeClient(pool, sessionId);
  }
  const client = await connectFn();
  const now = monotonicSeconds();
  const handle: ClientHandle<C> = {
    fingerprint,
    client,
    lock: new AsyncLock(),
    connectedAt: now,
    lastUsed: now,
    turnsServed: 0,
  };
  pool.set(sessionId, handle);
  await trimPoolToCap(pool);
  return handle;
}

/** Pop first so a concurrent turn can never re-grab a disposing client, then disconnect. Never
 * throws: teardown must not block a turn or a close. Mirrors `dispose_client` exactly. */
export async function disposeClient<C extends PooledClient>(pool: Map<string, ClientHandle<C>>, sessionId: string): Promise<void> {
  const handle = pool.get(sessionId);
  if (!handle) return;
  pool.delete(sessionId);
  try {
    await handle.client.disconnect();
  } catch {
    // subprocess may already be dead; never let teardown raise
  }
}

/** Sync-context teardown: pop now, disconnect in a detached background task. Mirrors
 * `dispose_client_soon` exactly (JS has no sync/async distinction the way Python's event loop does,
 * but the pop-before-await ordering is what the Python original's own comment calls load-bearing --
 * preserved here). */
export function disposeClientSoon<C extends PooledClient>(pool: Map<string, ClientHandle<C>>, sessionId: string): void {
  const handle = pool.get(sessionId);
  if (!handle) return;
  pool.delete(sessionId);
  void handle.client.disconnect().catch(() => {
    // background disconnect failure is swallowed, mirrors the Python original
  });
}

/** Process-shutdown hook: a persistent subprocess outlives turns, so a reload/quit would orphan one
 * CLI per live session without this. Mirrors `dispose_all_clients` exactly. */
export async function disposeAllClients<C extends PooledClient>(pool: Map<string, ClientHandle<C>>): Promise<void> {
  for (const sid of [...pool.keys()]) {
    await disposeClient(pool, sid);
  }
}

export interface PoolSweeperHandle {
  stop(): Promise<void>;
}

/** Launch the background reclaim loop: runs the idle-TTL sweep AND the cap trim on a timer so a
 * pool that went all-quiet frees its subprocesses instead of waiting on the next turn's lazy
 * acquire-time sweep. Mirrors `start_pool_sweeper`/`p_pool_sweeper_loop`/`stop_pool_sweeper`. */
export function startPoolSweeper<C extends PooledClient>(pool: Map<string, ClientHandle<C>>): PoolSweeperHandle {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  function sleep(): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(() => {
        timer = null;
        wake = null;
        resolve();
      }, poolConfig.SWEEP_INTERVAL_SECONDS * 1000);
    });
  }

  const run = (async () => {
    while (!cancelled) {
      await sleep();
      if (cancelled) break;
      try {
        await evictIdleClients(pool);
        await trimPoolToCap(pool);
      } catch {
        // one bad sweep iteration must not kill the loop
      }
    }
  })();

  return {
    stop: async () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (wake !== null) {
        const resolve = wake;
        wake = null;
        resolve();
      }
      await run;
    },
  };
}

/** Cancel + await the sweeper. Call BEFORE disposeAllClients so a sweep can't race teardown. `null`
 * is a no-op, mirrors `stop_pool_sweeper(None)`. */
export async function stopPoolSweeper(handle: PoolSweeperHandle | null): Promise<void> {
  if (handle === null) return;
  await handle.stop();
}

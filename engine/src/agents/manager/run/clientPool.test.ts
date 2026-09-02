// engine/src/agents/manager/run/clientPool.test.ts -- AGT-4. Ports backend/tests/test_client_pool.py
// case-for-case: fingerprint stability/sensitivity, reuse/respawn/force/teardown, idle eviction,
// cap LRU eviction, the soft-cap-exceeds-when-busy invariant, the background sweeper, and the
// seeded-simulation invariant (never reuse a stale client, never double-boot, always recover a dead
// one). Uses real short sleeps (ms-scale), same spirit as the Python original's `asyncio.sleep`.

import { describe, expect, it } from 'vitest';
import {
  acquireClient,
  bootFingerprint,
  disposeAllClients,
  disposeClient,
  disposeClientSoon,
  evictIdleClients,
  poolConfig,
  startPoolSweeper,
  stopPoolSweeper,
  trimPoolToCap,
  type ClientHandle,
  type PooledClient,
} from './clientPool';
import { createAgentSession, createMessageBranch } from '../../sessionFactory';

class FakeClient implements PooledClient {
  alive = true;
  disconnected = false;
  constructor(
    private readonly registry: FakeClient[],
    private readonly raiseOnDisconnect = false,
  ) {
    registry.push(this);
  }
  async disconnect(): Promise<void> {
    this.disconnected = true;
    this.alive = false;
    if (this.raiseOnDisconnect) throw new Error('teardown boom');
  }
}

function makeSession(branch = 'main', compacted: string | null = null) {
  const s = createAgentSession({
    id: 't',
    name: 't',
    model: 'haiku',
    created_at: '2026-01-01T00:00:00',
    branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
  });
  s.active_branch_id = branch;
  s.compacted_through_msg_id = compacted;
  return s;
}

const BASE_KWARGS: Record<string, unknown> = {
  model: 'haiku',
  cwd: '/tmp/ws',
  system_prompt: { type: 'preset', preset: 'claude_code' },
  allowed_tools: ['Read'],
  disallowed_tools: ['mcp__claude_ai_*'],
  mcp_servers: { 'maestro-mcp-meta': { command: 'python', args: ['m.py'], type: 'stdio' } },
  can_use_tool: () => null,
  stderr: (_line: string) => {},
  hooks: { PreToolUse: [] },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('bootFingerprint', () => {
  it('is stable across per-turn keys (can_use_tool/stderr/hooks/resume/fork_session changing)', () => {
    const s = makeSession();
    const a = bootFingerprint({ ...BASE_KWARGS }, s);
    const changed = {
      ...BASE_KWARGS,
      can_use_tool: () => 1,
      stderr: (_line: string) => 1,
      hooks: { PreToolUse: ['different'] },
      resume: 'sdk-session-xyz',
      fork_session: true,
    };
    expect(bootFingerprint(changed, s)).toBe(a);
  });

  const mutations: Array<[string, (k: Record<string, unknown>, s: ReturnType<typeof makeSession>) => void]> = [
    ['mcp_servers grows', (k) => { k.mcp_servers = { ...(k.mcp_servers as object), x: { command: 'node', type: 'stdio' } }; }],
    ['system_prompt append changes', (k) => { k.system_prompt = { type: 'preset', preset: 'claude_code', append: 'sel' }; }],
    ['model changes', (k) => { k.model = 'gpt-5-mini'; }],
    ['cwd changes', (k) => { k.cwd = '/tmp/other'; }],
    ['allowed_tools changes', (k) => { k.allowed_tools = ['Read', 'Bash']; }],
    ['active_branch_id changes', (_k, s) => { s.active_branch_id = 'branch2'; }],
    ['compacted_through_msg_id changes', (_k, s) => { s.compacted_through_msg_id = 'msg42'; }],
  ];

  it.each(mutations)('changes when %s', (_label, mutate) => {
    const s = makeSession();
    const kwargs: Record<string, unknown> = { ...BASE_KWARGS, mcp_servers: { ...(BASE_KWARGS.mcp_servers as object) } };
    const before = bootFingerprint(kwargs, s);
    mutate(kwargs, s);
    expect(bootFingerprint(kwargs, s)).not.toBe(before);
  });
});

describe('acquireClient / disposeClient (ports test_reuse_respawn_force_and_teardown)', () => {
  it('reuses on matching fingerprint, respawns on mismatch or force, and tears down cleanly (incl. a raising disconnect and dispose_client_soon)', async () => {
    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    const connect = async () => new FakeClient(made);

    const h1 = await acquireClient(pool, 's1', 'fpA', connect);
    const h2 = await acquireClient(pool, 's1', 'fpA', connect);
    expect(h2).toBe(h1);
    expect(made).toHaveLength(1);

    const h3 = await acquireClient(pool, 's1', 'fpB', connect);
    expect(h3).not.toBe(h1);
    expect(made).toHaveLength(2);
    expect(made[0].disconnected).toBe(true);

    const h4 = await acquireClient(pool, 's1', 'fpB', connect, true);
    expect(h4).not.toBe(h3);
    expect(made).toHaveLength(3);
    expect(made[1].disconnected).toBe(true);

    await disposeClient(pool, 's1');
    expect(pool.has('s1')).toBe(false);
    expect(made[2].disconnected).toBe(true);
    await disposeClient(pool, 's1'); // idempotent

    const connectBad = async () => new FakeClient(made, true);
    await acquireClient(pool, 's2', 'fp', connectBad);
    await disposeClient(pool, 's2'); // teardown error swallowed
    expect(pool.has('s2')).toBe(false);

    await acquireClient(pool, 's3', 'fp', connect);
    disposeClientSoon(pool, 's3');
    expect(pool.has('s3')).toBe(false); // pop is sync-first
    await sleep(10);
    expect(made[made.length - 1].disconnected).toBe(true);

    await acquireClient(pool, 's4', 'fp', connect);
    await acquireClient(pool, 's5', 'fp', connect);
    await disposeAllClients(pool);
    expect(pool.size).toBe(0);
    expect(made.every((c) => c.disconnected)).toBe(true);
  });
});

describe('idle eviction (ports test_idle_eviction)', () => {
  it('skips a mid-turn (locked) session and evicts only the idle one, then reconnects transparently', async () => {
    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    const connect = async () => new FakeClient(made);
    const oldTtl = poolConfig.IDLE_EVICT_SECONDS;
    poolConfig.IDLE_EVICT_SECONDS = 0.05;
    try {
      const h = await acquireClient(pool, 's1', 'fp', connect);
      await acquireClient(pool, 's2', 'fp', connect);
      await sleep(100);
      await h.lock.acquire();
      try {
        await evictIdleClients(pool);
        expect(pool.has('s1')).toBe(true);
        expect(pool.has('s2')).toBe(false);
        expect(made[1].disconnected).toBe(true);
      } finally {
        h.lock.release();
      }
      await sleep(100);
      await evictIdleClients(pool);
      expect(pool.has('s1')).toBe(false);
      expect(made[0].disconnected).toBe(true);

      const h2 = await acquireClient(pool, 's1', 'fp', connect);
      expect(h2.client.alive).toBe(true);
    } finally {
      poolConfig.IDLE_EVICT_SECONDS = oldTtl;
    }
  });
});

describe('cap LRU eviction (ports test_cap_lru_eviction)', () => {
  it('trims the least-recently-used idle sessions over the cap and keeps the newest', async () => {
    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    const connect = async () => new FakeClient(made);
    const oldMax = poolConfig.MAX_LIVE_CLIENTS;
    const oldGuard = poolConfig.LRU_GUARD_SECONDS;
    poolConfig.MAX_LIVE_CLIENTS = 3;
    poolConfig.LRU_GUARD_SECONDS = 0.0;
    try {
      for (let i = 0; i < 5; i++) {
        await acquireClient(pool, `s${i}`, 'fp', connect);
        await sleep(2); // distinct lastUsed so LRU order is deterministic
      }
      expect(pool.size).toBe(3);
      expect(pool.has('s0')).toBe(false);
      expect(pool.has('s1')).toBe(false);
      expect(pool.has('s2')).toBe(true);
      expect(pool.has('s3')).toBe(true);
      expect(pool.has('s4')).toBe(true);
      expect(made[0].disconnected).toBe(true);
      expect(made[1].disconnected).toBe(true);
      expect(made[3].disconnected).toBe(false);
      expect(made[4].disconnected).toBe(false);
    } finally {
      poolConfig.MAX_LIVE_CLIENTS = oldMax;
      poolConfig.LRU_GUARD_SECONDS = oldGuard;
    }
  });
});

describe('cap soft-exceeds when busy (ports test_cap_soft_exceeds_when_busy)', () => {
  it('cannot evict mid-turn clients: exceeds the cap rather than kill a live turn, then trims back once idle', async () => {
    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    const connect = async () => new FakeClient(made);
    const oldMax = poolConfig.MAX_LIVE_CLIENTS;
    const oldGuard = poolConfig.LRU_GUARD_SECONDS;
    poolConfig.MAX_LIVE_CLIENTS = 2;
    poolConfig.LRU_GUARD_SECONDS = 0.4;
    try {
      const h0 = await acquireClient(pool, 's0', 'fp', connect);
      const h1 = await acquireClient(pool, 's1', 'fp', connect);
      await h0.lock.acquire();
      await h1.lock.acquire();
      try {
        await acquireClient(pool, 's2', 'fp', connect);
        // s0/s1 locked, s2 just-acquired (guard-protected): nothing eligible, pool exceeds the cap.
        expect(pool.size).toBe(3);
        expect(made[0].disconnected).toBe(false);
        expect(made[1].disconnected).toBe(false);
      } finally {
        h0.lock.release();
        h1.lock.release();
      }
      await sleep(500); // past the guard: the now-idle sessions become eligible
      await trimPoolToCap(pool);
      expect(pool.size).toBe(2);
      expect(made[0].disconnected).toBe(true); // oldest idle reaped back to cap
    } finally {
      poolConfig.MAX_LIVE_CLIENTS = oldMax;
      poolConfig.LRU_GUARD_SECONDS = oldGuard;
    }
  });
});

describe('background pool sweeper (ports test_pool_sweeper_reclaims_over_cap)', () => {
  it('trims an over-cap pool on its own timer, with no new turn to trigger it', async () => {
    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    const connect = async () => new FakeClient(made);
    const oldMax = poolConfig.MAX_LIVE_CLIENTS;
    const oldGuard = poolConfig.LRU_GUARD_SECONDS;
    const oldInt = poolConfig.SWEEP_INTERVAL_SECONDS;
    poolConfig.MAX_LIVE_CLIENTS = 10;
    poolConfig.LRU_GUARD_SECONDS = 0.0;
    poolConfig.SWEEP_INTERVAL_SECONDS = 0.02;
    try {
      for (let i = 0; i < 5; i++) {
        await acquireClient(pool, `s${i}`, 'fp', connect);
        await sleep(2);
      }
      expect(pool.size).toBe(5); // under the temporary high cap
      poolConfig.MAX_LIVE_CLIENTS = 3;
      const handle = startPoolSweeper(pool);
      await sleep(150); // several sweep cycles
      await stopPoolSweeper(handle);
      expect(pool.size).toBe(3);
      expect(pool.has('s0')).toBe(false);
      expect(pool.has('s1')).toBe(false);
      await stopPoolSweeper(null); // no-op, must not throw
    } finally {
      poolConfig.MAX_LIVE_CLIENTS = oldMax;
      poolConfig.LRU_GUARD_SECONDS = oldGuard;
      poolConfig.SWEEP_INTERVAL_SECONDS = oldInt;
    }
  });
});

describe('seeded simulation invariants (ports test_seeded_simulation_invariants)', () => {
  it('reuse only on identical fingerprint; dead clients always replaced; pool never re-serves a disposed client; boots never exceed the one-shot baseline', async () => {
    // Deterministic xorshift-ish PRNG (Node has no seedable Math.random) -- mirrors random.Random(1337)
    // in spirit only (a different sequence is fine; the invariants checked don't depend on the
    // exact draw, only on the operation-mix behaving correctly over many random sequences).
    let state = 1337;
    function rnd(): number {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    }
    function choice<T>(arr: readonly T[]): T {
      return arr[Math.floor(rnd() * arr.length)];
    }

    const pool = new Map<string, ClientHandle<FakeClient>>();
    const made: FakeClient[] = [];
    let boots = 0;
    let turns = 0;
    let fp = 'fp0';
    let force = false;
    const connect = async () => {
      boots += 1;
      return new FakeClient(made);
    };

    for (let i = 0; i < 300; i++) {
      const op = choice(['follow_up', 'activate', 'branch_or_fresh', 'kill', 'close'] as const);
      if (op === 'follow_up') {
        turns += 1;
        let h = await acquireClient(pool, 'sim', fp, connect, force);
        force = false;
        expect(h.fingerprint).toBe(fp);
        expect(h.client.disconnected).toBe(false);
        if (!h.client.alive) {
          // dead client detected by the turn -> dispose + one respawn
          await disposeClient(pool, 'sim');
          h = await acquireClient(pool, 'sim', fp, connect);
          expect(h.client.alive).toBe(true);
        }
        await h.lock.acquire();
        try {
          expect(h.lock.locked()).toBe(true); // single consumer while a turn drains
          h.turnsServed += 1;
        } finally {
          h.lock.release();
        }
      } else if (op === 'activate') {
        fp = `fp${Math.floor(rnd() * 1_000_000_000)}`; // mcp_servers grew -> fingerprint changed
      } else if (op === 'branch_or_fresh') {
        force = true; // needs_fresh/fork read pre-build forces respawn
      } else if (op === 'kill' && pool.has('sim')) {
        pool.get('sim')!.client.alive = false;
      } else if (op === 'close') {
        await disposeClient(pool, 'sim');
      }
    }

    expect(boots).toBeLessThanOrEqual(turns);
    const live = made.filter((c) => !c.disconnected);
    expect(live.length).toBeLessThanOrEqual(1);
    if (pool.has('sim')) {
      expect(pool.get('sim')!.client.disconnected).toBe(false);
    }
  });
});

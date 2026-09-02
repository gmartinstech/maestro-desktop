// AGT-2 gate: emit paths (sendToSession) and the resume/replay path (replayTo, including gap
// detection, stale-approval filtering, and agent:closed stripping), plus lighter coverage of the
// approval/browser-command/connection-registry surface. DI'd fake sockets throughout -- no real
// WebSocket, no real disk (a fake TerminalEventStore), same spirit as
// engine/src/browser/screencast.test.ts's fake CdpSession/UiSocketLike.
import { describe, expect, it, vi } from 'vitest';
import { AgentSeqLog, ConnectionManager, TERMINAL_STATUSES, awaitReconnect, type AgentSocketLike, type TerminalEventStore } from './wsManager';

function makeFakeSocket(): AgentSocketLike & { received: string[]; failNext: boolean } {
  return {
    received: [],
    failNext: false,
    send(data: string) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('send failed');
      }
      this.received.push(data);
    },
  };
}

function makeFakeTerminalStore(): TerminalEventStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    persist(sessionId, payloadStr) {
      store.set(sessionId, payloadStr);
    },
    load(sessionId) {
      return store.get(sessionId) ?? null;
    },
  };
}

function makeManager() {
  const terminalStore = makeFakeTerminalStore();
  const manager = new ConnectionManager({ terminalStore });
  return { manager, terminalStore };
}

describe('ConnectionManager.sendToSession', () => {
  it('stamps a monotonic seq per session and delivers the exact envelope to session + global sockets', async () => {
    const { manager } = makeManager();
    const sessionSocket = makeFakeSocket();
    const globalSocket = makeFakeSocket();
    manager.connectSession('s1', sessionSocket);
    manager.connectGlobal(globalSocket);

    await manager.sendToSession('s1', 'agent:cost_update', { session_id: 's1', cost_usd: 0.5 });
    await manager.sendToSession('s1', 'agent:cost_update', { session_id: 's1', cost_usd: 0.75 });

    expect(sessionSocket.received).toHaveLength(2);
    expect(globalSocket.received).toHaveLength(2);
    expect(JSON.parse(sessionSocket.received[0])).toEqual({
      event: 'agent:cost_update',
      session_id: 's1',
      data: { session_id: 's1', cost_usd: 0.5 },
      seq: 1,
    });
    expect(JSON.parse(sessionSocket.received[1]).seq).toBe(2);
    expect(manager.currentSeq('s1')).toBe(2);
  });

  it('keeps two sessions\' seq counters independent', async () => {
    const { manager } = makeManager();
    manager.connectSession('a', makeFakeSocket());
    manager.connectSession('b', makeFakeSocket());
    await manager.sendToSession('a', 'agent:queued', { session_id: 'a' });
    await manager.sendToSession('b', 'agent:queued', { session_id: 'b' });
    await manager.sendToSession('a', 'agent:admitted', { session_id: 'a' });
    expect(manager.currentSeq('a')).toBe(2);
    expect(manager.currentSeq('b')).toBe(1);
  });

  it('does not deliver a session event to a different session\'s sockets', async () => {
    const { manager } = makeManager();
    const other = makeFakeSocket();
    manager.connectSession('other-session', other);
    await manager.sendToSession('this-session', 'agent:queued', { session_id: 'this-session' });
    expect(other.received).toHaveLength(0);
  });

  it('keeps broadcasting to remaining sockets when one send throws', async () => {
    const { manager } = makeManager();
    const bad = makeFakeSocket();
    bad.failNext = true;
    const good = makeFakeSocket();
    manager.connectSession('s1', bad);
    manager.connectSession('s1', good);

    await expect(manager.sendToSession('s1', 'agent:queued', { session_id: 's1' })).resolves.toBeUndefined();
    expect(good.received).toHaveLength(1);
  });

  it.each(['completed', 'stopped', 'error'] as const)('persists a terminal agent:status (%s) snapshot', async (status) => {
    const { manager, terminalStore } = makeManager();
    manager.connectSession('s1', makeFakeSocket());
    await manager.sendToSession('s1', 'agent:status', { session_id: 's1', status });
    expect(TERMINAL_STATUSES.has(status)).toBe(true);
    expect(terminalStore.store.has('s1')).toBe(true);
    expect(JSON.parse(terminalStore.store.get('s1')!).data.status).toBe(status);
  });

  it('does not persist a non-terminal agent:status snapshot', async () => {
    const { manager, terminalStore } = makeManager();
    manager.connectSession('s1', makeFakeSocket());
    await manager.sendToSession('s1', 'agent:status', { session_id: 's1', status: 'running' });
    expect(terminalStore.store.has('s1')).toBe(false);
  });

  it('accepts the agent:status "lite" shape (no `session` key), matching the HITL-approval call sites', async () => {
    const { manager } = makeManager();
    manager.connectSession('s1', makeFakeSocket());
    await expect(manager.sendToSession('s1', 'agent:status', { session_id: 's1', status: 'waiting_approval' })).resolves.toBeUndefined();
  });
});

describe('ConnectionManager.replayTo', () => {
  it('reports replayed:0 and current_seq:0 for a brand-new session with nothing ever sent', async () => {
    const { manager } = makeManager();
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('fresh-session', socket, 0);
    expect(ack).toEqual({ ok: true, replayed: 0, current_seq: 0 });
    expect(socket.received).toHaveLength(0);
  });

  it('replays every buffered event newer than lastSeq, in order, and acks from_seq/to_seq', async () => {
    const { manager } = makeManager();
    manager.connectSession('s1', makeFakeSocket()); // exercises the live-socket fan-out path too
    for (let i = 0; i < 5; i += 1) {
      await manager.sendToSession('s1', 'agent:cost_update', { session_id: 's1', cost_usd: i });
    }
    const reconnectSocket = makeFakeSocket();
    const ack = await manager.replayTo('s1', reconnectSocket, 2);
    expect(ack).toEqual({ ok: true, replayed: 3, from_seq: 2, to_seq: 5 });
    expect(reconnectSocket.received.map((s) => JSON.parse(s).seq)).toEqual([3, 4, 5]);
  });

  it('lastSeq=0 (a genuinely fresh client) replays the full buffer, never a gap', async () => {
    const { manager } = makeManager();
    await manager.sendToSession('s1', 'agent:queued', { session_id: 's1' });
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('s1', socket, 0);
    expect(ack.ok).toBe(true);
    if (ack.ok) expect(ack).toMatchObject({ replayed: 1 });
  });

  it('strips agent:closed from the replay (a destructive transition event, non-lossy to omit)', async () => {
    const { manager } = makeManager();
    await manager.sendToSession('s1', 'agent:cost_update', { session_id: 's1', cost_usd: 1 });
    await manager.sendToSession('s1', 'agent:closed', {
      session_id: 's1',
      status: 'stopped',
      name: 'n',
      model: 'm',
      mode: 'agent',
      created_at: null,
      closed_at: null,
      cost_usd: 1,
    });
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('s1', socket, 0);
    expect(socket.received.map((s) => JSON.parse(s).event)).toEqual(['agent:cost_update']);
    expect(ack).toMatchObject({ replayed: 1 });
  });

  it('filters an agent:approval_request whose request_id already resolved, but keeps a still-pending one', async () => {
    const { manager } = makeManager();
    const resolvePromise = manager.sendApprovalRequest('s1', 'req-resolved', 'Bash', { command: 'ls' });
    manager.resolveApproval('req-resolved', { behavior: 'allow' });
    await resolvePromise; // the `finally` block's pendingApprovals.delete has now run

    // A second request left deliberately unresolved -- still "alive" when replay runs. Not
    // awaited (nobody ever answers it), but its stamp is queued on the SAME per-session mutex as
    // the dummy event right below, so awaiting that one guarantees this one's buffer push has
    // already landed (the mutex processes both in the order they were enqueued).
    void manager.sendApprovalRequest('s1', 'req-pending', 'Write', { path: '/x' });
    await manager.sendToSession('s1', 'agent:queued', { session_id: 's1' });

    const socket = makeFakeSocket();
    const ack = await manager.replayTo('s1', socket, 0);
    const events = socket.received.map((s) => JSON.parse(s));
    expect(events.filter((e) => e.event === 'agent:approval_request').map((e) => e.data.request_id)).toEqual(['req-pending']);
    expect(ack).toMatchObject({ replayed: 2 }); // req-resolved is filtered out; req-pending + agent:queued remain
  });

  it('detects a gap when lastSeq predates the ring buffer and sends agent:gap_detected instead of a partial replay', async () => {
    const { manager } = makeManager();
    const RING_BUFFER_LIMIT = 500;
    for (let i = 0; i < RING_BUFFER_LIMIT + 5; i += 1) {
      await manager.sendToSession('s1', 'agent:cost_update', { session_id: 's1', cost_usd: i });
    }
    // Buffer now holds seq 6..505; lastSeq=1 is well before oldest-1=5.
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('s1', socket, 1);
    expect(ack).toEqual({ ok: false, reason: 'gap', oldest_seq: 6, newest_seq: RING_BUFFER_LIMIT + 5 });
    expect(socket.received).toHaveLength(1);
    const gapFrame = JSON.parse(socket.received[0]);
    expect(gapFrame).toEqual({
      event: 'agent:gap_detected',
      session_id: 's1',
      data: { session_id: 's1', oldest_seq: 6, newest_seq: RING_BUFFER_LIMIT + 5, client_seq: 1 },
    });
  });

  it('does NOT report a gap merely because lastSeq is 1 behind the oldest buffered seq (boundary, not a miss)', async () => {
    const { manager } = makeManager();
    await manager.sendToSession('s1', 'agent:queued', { session_id: 's1' }); // seq 1
    await manager.sendToSession('s1', 'agent:admitted', { session_id: 's1' }); // seq 2
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('s1', socket, 0);
    expect(ack.ok).toBe(true);
  });

  it('replays the persisted terminal snapshot when the in-memory buffer is empty (process restarted)', async () => {
    const { manager, terminalStore } = makeManager();
    terminalStore.store.set('restarted-session', JSON.stringify({ event: 'agent:status', session_id: 'restarted-session', data: { session_id: 'restarted-session', status: 'completed' }, seq: 9 }));
    const socket = makeFakeSocket();
    const ack = await manager.replayTo('restarted-session', socket, 0);
    expect(ack).toEqual({ ok: true, replayed: 1, terminal_only: true });
    expect(socket.received).toEqual([terminalStore.store.get('restarted-session')]);
  });
});

describe('AgentSeqLog', () => {
  it('replay() on a session that was never stamped returns nulls and an empty list, not a crash', () => {
    const log = new AgentSeqLog();
    expect(log.replay('never-seen', 0)).toEqual({ oldest: null, newest: null, events: [] });
    expect(log.currentSeq('never-seen')).toBe(0);
  });
});

describe('ConnectionManager approvals', () => {
  it('sendApprovalRequest resolves with the decision resolveApproval supplies', async () => {
    const { manager } = makeManager();
    manager.connectSession('s1', makeFakeSocket());
    const pending = manager.sendApprovalRequest('s1', 'req-1', 'Bash', { command: 'rm -rf /tmp/x' });
    manager.resolveApproval('req-1', { behavior: 'deny', message: 'no' });
    await expect(pending).resolves.toEqual({ behavior: 'deny', message: 'no' });
  });

  it('times out to a deny decision when nobody answers', async () => {
    const { manager } = makeManager();
    manager.connectSession('s1', makeFakeSocket());
    const pending = manager.sendApprovalRequest('s1', 'req-timeout', 'Bash', {}, { timeoutMs: 5 });
    await expect(pending).resolves.toEqual({ behavior: 'deny', message: 'Approval timed out' });
  });

  it('resolveApproval on an unknown or already-settled request_id is a harmless no-op', () => {
    const { manager } = makeManager();
    expect(() => manager.resolveApproval('no-such-request', { behavior: 'allow' })).not.toThrow();
  });
});

describe('ConnectionManager connection registry', () => {
  it('routes set_active_dashboard / disconnect_global fallback the same way the Python original does', () => {
    const { manager } = makeManager();
    const a = makeFakeSocket();
    const b = makeFakeSocket();
    manager.connectGlobal(a);
    manager.connectGlobal(b);
    manager.setActiveDashboard(a, 'dash-a');
    manager.setActiveDashboard(b, 'dash-b');
    expect(manager.activeDashboardId).toBe('dash-b');

    manager.disconnectGlobal(b);
    expect(manager.activeDashboardId).toBe('dash-a'); // falls back to the still-connected window

    manager.disconnectGlobal(a);
    expect(manager.activeDashboardId).toBeNull();
  });

  it('connectMain/disconnectMain only clears the slot for the exact socket that owned it', () => {
    const { manager } = makeManager();
    const main1 = makeFakeSocket();
    manager.connectMain(main1);
    const other = makeFakeSocket();
    manager.disconnectMain(other); // a stale/wrong socket must not clobber the real one
    expect(manager['mainConnectionSocket']).toBe(main1);
    manager.disconnectMain(main1);
    expect(manager['mainConnectionSocket']).toBeNull();
  });

  it('disconnectSession removes only the given socket, and drops the session entry once empty', async () => {
    const { manager } = makeManager();
    const a = makeFakeSocket();
    const b = makeFakeSocket();
    manager.connectSession('s1', a);
    manager.connectSession('s1', b);
    manager.disconnectSession('s1', a);
    await manager.sendToSession('s1', 'agent:queued', { session_id: 's1' });
    expect(a.received).toHaveLength(0);
    expect(b.received).toHaveLength(1);
  });
});

describe('ConnectionManager.broadcastGlobal', () => {
  it('reaps a socket whose send throws so a later broadcast no longer targets it', async () => {
    const { manager } = makeManager();
    const dying = makeFakeSocket();
    dying.failNext = true;
    manager.connectGlobal(dying);
    await manager.broadcastGlobal('browser:command', { action: 'noop' });
    expect(dying.received).toHaveLength(0);

    const survivor = makeFakeSocket();
    manager.connectGlobal(survivor);
    await manager.broadcastGlobal('browser:command', { action: 'second' });
    // The reaped socket is gone from globalConnections; only the survivor got this one.
    expect(survivor.received).toHaveLength(1);
  });
});

describe('ConnectionManager.sendBrowserCommand', () => {
  it('answers immediately with the resolved result once a connected dashboard replies, without waiting for the full timeout', async () => {
    const { manager } = makeManager();
    const dashboard: AgentSocketLike = {
      send: (data: string) => {
        const parsed = JSON.parse(data) as { data: { request_id: string } };
        manager.resolveBrowserCommand(parsed.data.request_id, { ok: true });
      },
    };
    manager.connectGlobal(dashboard);
    const result = await manager.sendBrowserCommand('req-1', 'wait', 'browser-1', { selector: '#x' });
    expect(result).toEqual({ ok: true });
  });

  it('fails fast with a clear error when no dashboard is connected and none reconnects', async () => {
    vi.useFakeTimers();
    try {
      const { manager } = makeManager();
      const pending = manager.sendBrowserCommand('req-1', 'wait', 'browser-1', {});
      await vi.advanceTimersByTimeAsync(8_000); // awaitReconnect's full poll window (WS_RECONNECT_WAIT_MS), virtual time
      await expect(pending).resolves.toEqual({ error: 'No dashboard is connected. Open the dashboard to use browser tools.' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('awaitReconnect', () => {
  it('returns true immediately when already connected', async () => {
    await expect(awaitReconnect(() => true)).resolves.toBe(true);
  });

  it('polls virtual time and picks up a reconnect partway through the window', async () => {
    vi.useFakeTimers();
    try {
      let connected = false;
      setTimeout(() => {
        connected = true;
      }, 1_200); // lands between two of the 500ms polls
      const pending = awaitReconnect(() => connected);
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(pending).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after WS_RECONNECT_WAIT_MS with nobody ever reconnecting', async () => {
    vi.useFakeTimers();
    try {
      const pending = awaitReconnect(() => false);
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

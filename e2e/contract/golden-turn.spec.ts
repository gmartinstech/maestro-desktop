// e2e/contract/golden-turn.spec.ts — CTR-4
//
// The headless golden TURN, not just boot: create a session over HTTP, open the WS, send one
// user message, and assert the FULL deterministic MAESTRO_MOCK_AGENT=1 reply arrives as the
// exact WS event sequence, ending in a terminating status. `e2e/golden/golden-path.spec.ts`
// deliberately only proves the app boots and the backend serves — its own header says so — so a
// total agent-loop regression would sail through it unnoticed. This is the test that would catch
// that, and per the migration plan it is the SAME file, run unmodified, against the TypeScript
// engine rewrite later (AGT-6) — implementation-agnostic on purpose: plain HTTP/WS against
// whatever answers at the booted base URL, no Python-specific assumption anywhere below.
//
// Run standalone: `npx playwright test e2e/contract/golden-turn.spec.ts`
import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootBackend, type BackendHandle } from './fixtures';

// Cold backend boot (first-run cache warms) can take a while; generous test-level budget so a
// slow first launch doesn't flake, matching e2e/golden's own 180s allowance.
test.setTimeout(180_000);

// backend/apps/agents/manager/MockAgent.py's MOCK_REPLY_PREFIX — "Obviously-synthetic prefix so
// a mock reply can never be mistaken for a model reply". If this literal ever drifts from the
// backend's, this spec fails loudly rather than silently accepting a different reply shape.
const MOCK_REPLY_PREFIX = '[maestro-mock] echo: ';

interface WsFrame {
  event: string;
  session_id?: string;
  seq?: number;
  data: Record<string, unknown>;
}

/** Open the session WS and hand back a frame recorder plus a helper that waits for a predicate
 * over the accumulating frame list. */
async function connectSessionWs(backend: BackendHandle, sessionId: string) {
  const ws = new WebSocket(`${backend.wsBaseUrl}/ws/agents/${sessionId}?token=${encodeURIComponent(backend.token)}`);
  const frames: WsFrame[] = [];
  ws.addEventListener('message', (ev) => {
    frames.push(JSON.parse(ev.data as string));
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('close', (ev) => reject(new Error(`ws closed before open (code ${ev.code})`)), { once: true });
  });

  async function waitFor(predicate: (fs: WsFrame[]) => boolean, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(frames)) return;
      if (ws.readyState === WebSocket.CLOSED) {
        throw new Error(`ws closed while waiting; frames so far: ${JSON.stringify(frames, null, 2)}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for predicate; frames so far: ${JSON.stringify(frames, null, 2)}`);
  }

  return { ws, frames, waitFor };
}

test('golden turn: HTTP session create + WS send_message drives the deterministic mock reply to a terminating status', async ({}, testInfo) => {
  const backend = await bootBackend();
  testInfo.annotations.push({ type: 'backend-http-base', description: backend.httpBaseUrl });
  // AgentLaunch.py re-routes an unset target_directory that would otherwise resolve to the
  // user's real home into `~/.maestro/workspaces/<id>` using the OS home directly (NOT through
  // MAESTRO_STATE_HOME's override — see backend/apps/agents/manager/AgentLaunch.py:105-108 vs.
  // config/state_paths.py's home_state_dir/p_state_home, which does respect it). Passing an
  // explicit target_directory here sidesteps that gap entirely so this suite can never write
  // into the developer's real `~/.maestro`, matching every other isolation guarantee this file
  // (and e2e/golden/fixtures.ts) makes.
  const workDir = mkdtempSync(join(tmpdir(), 'maestro-contract-workdir-'));

  try {
    // ---- 1. Create a session over HTTP (no initial_message: the turn is driven over WS below,
    // exercising the same client -> server frame the real UI sends). Route + body per
    // backend/apps/agents/agents.py's POST /launch and core/models.py's AgentConfig. mode
    // "agent" and no dashboard_id keeps the browser-fast-path classifier out of the picture
    // entirely (it requires a dashboard_id; see browser_fast_path.fast_path_eligible), so this
    // turn can never race a live LLM call for routing.
    const launchRes = await fetch(`${backend.httpBaseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${backend.token}` },
      body: JSON.stringify({ name: 'CTR-4 golden turn', model: 'sonnet', mode: 'agent', target_directory: workDir }),
    });
    const launchBodyText = await launchRes.text();
    expect(launchRes.status, `POST /api/agents/launch -> ${launchRes.status}: ${launchBodyText}`).toBe(200);
    const launchBody = JSON.parse(launchBodyText);
    const sessionId: string = launchBody.session_id;
    expect(sessionId).toBeTruthy();
    expect(launchBody.prompt_delivered).toBe(false);

    // ---- 2. Open the session WS and do the resume handshake (client:hello -> server:hello),
    // same first exchange the real frontend WebSocketManager does on connect. Because /launch
    // already broadcast an `agent:status` (running) the instant the session was created — before
    // this WS existed to receive it live — the resume replay (last_seq=0, "fresh client") hands
    // that one buffered event back FIRST, ahead of server:hello itself (backend/main.py's
    // websocket_session: replay_to() runs, then THEN the server:hello frame is sent).
    const { frames, waitFor, ws } = await connectSessionWs(backend, sessionId);
    ws.send(JSON.stringify({
      event: 'client:hello',
      data: { session_id: sessionId, connection_uuid: 'ctr4-e2e', last_seq: 0 },
    }));
    await waitFor((fs) => fs.some((f) => f.event === 'server:hello'));

    expect(frames[0].event).toBe('agent:status');
    expect(frames[0].data.status).toBe('running');
    expect((frames[0].data.session as Record<string, unknown>).id).toBe(sessionId);

    expect(frames[1].event).toBe('server:hello');
    const ack = frames[1].data.ack as Record<string, unknown>;
    expect(ack.ok).toBe(true);
    expect(ack.replayed).toBe(1);

    // ---- 3. Send the user message over WS (client -> server `agent:send_message`; contract/ws/agents.ts AgentWsClientEvent).
    const prompt = 'hello from CTR-4';
    ws.send(JSON.stringify({
      event: 'agent:send_message',
      data: { session_id: sessionId, prompt },
    }));

    // ---- 4. Wait for the terminating event: a completed agent:status. This is the "turn is over" signal every reconnect/replay path also keys on (backend/apps/agents/core/seq_log.py TERMINAL_STATUSES).
    await waitFor((fs) => fs.some((f) => f.event === 'agent:status' && f.data.status === 'completed'));

    // ---- 5. Assert the exact event sequence from here on and its full deterministic content.
    // Order per backend/apps/agents/manager/Messaging.py (send_message) then MockAgent.py (run_mock_turn):
    // agent:message(user) -> agent:status(running) -> agent:stream_start -> agent:stream_delta* -> agent:stream_end -> agent:message(assistant) -> agent:status(completed).
    const turn = frames.slice(2);
    const expectedAssistantText = `${MOCK_REPLY_PREFIX}${prompt}`;

    expect(turn[0]?.event).toBe('agent:message');
    const userMsg = turn[0].data.message as Record<string, unknown>;
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toBe(prompt);

    expect(turn[1]?.event).toBe('agent:status');
    expect(turn[1].data.status).toBe('running');

    expect(turn[2]?.event).toBe('agent:stream_start');
    const streamMsgId = turn[2].data.message_id;
    expect(turn[2].data.role).toBe('assistant');
    expect(streamMsgId).toBeTruthy();

    // Every frame between stream_start and stream_end is a stream_delta for the same message_id;
    // reconstructing them must reproduce the exact deterministic reply text (delay=0.0 in mock
    // mode means these arrive back-to-back with no real pacing, so there's no timing flakiness
    // to account for here).
    let cursor = 3;
    let reconstructed = '';
    while (turn[cursor]?.event === 'agent:stream_delta') {
      expect(turn[cursor].data.message_id).toBe(streamMsgId);
      reconstructed += turn[cursor].data.delta as string;
      cursor++;
    }
    expect(reconstructed, 'reconstructed stream_delta text must equal the deterministic mock reply').toBe(expectedAssistantText);

    expect(turn[cursor]?.event).toBe('agent:stream_end');
    expect(turn[cursor].data.message_id).toBe(streamMsgId);
    cursor++;

    expect(turn[cursor]?.event).toBe('agent:message');
    const assistantMsg = turn[cursor].data.message as Record<string, unknown>;
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe(expectedAssistantText);
    expect(assistantMsg.id).toBe(streamMsgId);
    cursor++;

    // Terminating event: the exact one waitFor() above already confirmed arrived, now pinned to
    // its position (nothing unaccounted-for trails it) and its full session payload.
    expect(turn[cursor]?.event).toBe('agent:status');
    expect(turn[cursor].data.status).toBe('completed');
    const finalSession = turn[cursor].data.session as Record<string, unknown>;
    expect(finalSession.status).toBe('completed');
    expect(finalSession.id).toBe(sessionId);
    cursor++;

    expect(turn.length, `unexpected trailing frames: ${JSON.stringify(turn.slice(cursor))}`).toBe(cursor);

    ws.close();
  } finally {
    backend.close();
    try {
      // Best-effort like fixtures.ts's own temp-dir cleanup: `ensure_cwd_git_repo` ran `git init`
      // in workDir, and on Windows a just-exited git.exe (or an AV scan reacting to it) can hold
      // a handle open for a beat, turning an immediate rmSync into a transient EPERM. A leftover
      // dir under the OS temp root is harmless; it must never flip an otherwise-passing turn
      // assertion into a reported failure.
      rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`golden-turn: best-effort cleanup of ${workDir} failed (ignored): ${(e as Error).message}`);
    }
  }
});

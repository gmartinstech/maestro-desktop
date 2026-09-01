// e2e/contract/ws.spec.ts — WS contract for `/ws/agents/{session_id}` (backend/main.py).
// Points at whatever backend scripts/run-contract-tests.mjs booted (MAESTRO_MOCK_AGENT=1,
// isolated data dirs) via CONTRACT_HTTP_URL / CONTRACT_TOKEN. Message shapes replayed here
// are cross-checked against contract/ws/agents.ts (CTR-2's frozen WS contract), but this
// file asserts on what the live backend actually does — if the two ever disagree, live
// behavior wins and the discrepancy gets called out, not silently trusted away.

import { test, expect } from '@playwright/test';
import {
  loadContractConfig,
  launchAgentSession,
  openAgentSocket,
  sendJson,
  waitForOpen,
  waitForClose,
  waitForMessage,
  collectUntil,
} from './run';

const cfg = loadContractConfig();

test('valid token: WS handshake connects and answers client:hello with server:hello', async () => {
  const sessionId = await launchAgentSession(cfg);
  const { ws, messages } = openAgentSocket(cfg, sessionId);
  try {
    await waitForOpen(ws);
    sendJson(ws, { event: 'client:hello', data: { last_seq: 0, connection_uuid: 'contract-valid' } });
    const hello = await waitForMessage(messages, (m) => m.event === 'server:hello');
    expect(hello.session_id).toBe(sessionId);
    expect(hello.data.ack.ok).toBe(true);
    expect(typeof hello.data.current_seq).toBe('number');
  } finally {
    ws.close();
  }
});

// DISCREPANCY (source vs. live behavior — this file trusts live behavior per this ticket's
// instructions): backend/main.py's p_ws_auth_ok() literally calls `websocket.close(code=4401)`
// on a bad/missing token, and its own comment claims "the client receives a 403 on handshake".
// Neither is what a real client observes. `.close()` here runs BEFORE `.accept()` — the ASGI
// spec (which uvicorn implements) treats a close sent pre-accept as a handshake REJECTION, not
// a WS close frame, so `code=4401` is never actually written to the wire. And rather than a
// clean HTTP 403, a plain WebSocket client (this suite's, and any browser's) sees the TCP
// connection simply drop mid-handshake, which W3C WebSocket clients report as close code 1006
// (CLOSE_ABNORMAL) with no reason string — confirmed empirically against the live backend
// before writing this assertion. 1006 is what this test pins; a future rewrite that instead
// completes the handshake and sends a real 4401 close frame would be a (desirable) behavior
// change this test should then be updated to match, not evidence this test was wrong to pin
// live behavior now.
const P_BAD_TOKEN_CLOSE_CODE = 1006;

test('missing token: server drops the connection (observed close code 1006)', async () => {
  const sessionId = await launchAgentSession(cfg);
  const { ws } = openAgentSocket(cfg, sessionId, { token: null });
  const closed = await waitForClose(ws);
  expect(closed.code).toBe(P_BAD_TOKEN_CLOSE_CODE);
});

test('wrong token: server drops the connection (observed close code 1006)', async () => {
  const sessionId = await launchAgentSession(cfg);
  const { ws } = openAgentSocket(cfg, sessionId, { token: 'not-the-real-token' });
  const closed = await waitForClose(ws);
  expect(closed.code).toBe(P_BAD_TOKEN_CLOSE_CODE);
});

test('resume: a client that disconnects mid-turn gets the missed events replayed on reconnect', async () => {
  const sessionId = await launchAgentSession(cfg);

  // --- leg 1: connect, hello, drive one full mock turn, record everything it emits ---
  const leg1 = openAgentSocket(cfg, sessionId);
  await waitForOpen(leg1.ws);
  sendJson(leg1.ws, { event: 'client:hello', data: { last_seq: 0, connection_uuid: 'contract-resume-1' } });
  await waitForMessage(leg1.messages, (m) => m.event === 'server:hello');

  // Sent over the WS contract's own `agent:send_message` frame (not the REST /message route),
  // which sidesteps that route's fire-and-forget MCP-suggestion classifier and turn-label
  // background task — neither is part of this contract, and both would otherwise reach for a
  // provider client this isolated test env never configured with credentials.
  sendJson(leg1.ws, { event: 'agent:send_message', data: { session_id: sessionId, prompt: 'resume test' } });

  // Deterministic full sequence for one MAESTRO_MOCK_AGENT=1 turn (see
  // backend/apps/agents/manager/Messaging.py + MockAgent.py::run_mock_turn): agent:message
  // (the user's own prompt, echoed back before the turn starts), agent:status(running),
  // agent:stream_start, N x agent:stream_delta, agent:stream_end,
  // agent:message(assistant reply), agent:status(completed).
  const fullRun = await collectUntil(
    leg1.messages,
    (m) => m.event === 'agent:status' && m.data?.status === 'completed',
  );
  const seqOf = (m: any) => m.seq as number;
  const seqEvents = fullRun.filter((m) => typeof m.seq === 'number');
  expect(seqEvents.length).toBeGreaterThan(3);
  // Sanity: seq is strictly increasing and gap-free on the live connection, before we ever
  // touch resume — otherwise a "replay matches the tail" assertion below would be meaningless.
  for (let i = 1; i < seqEvents.length; i++) {
    expect(seqOf(seqEvents[i])).toBe(seqOf(seqEvents[i - 1]) + 1);
  }

  // Cut the client's known history short, partway through the turn, then disconnect — this is
  // the "client vanished mid-stream" scenario the resume handshake exists for.
  const cutIndex = Math.floor(seqEvents.length / 2);
  const lastSeqSeen = seqOf(seqEvents[cutIndex]);
  const expectedReplay = seqEvents.slice(cutIndex + 1);
  expect(expectedReplay.length).toBeGreaterThan(0);
  leg1.ws.close();
  await waitForClose(leg1.ws);

  // --- leg 2: reconnect with last_seq = lastSeqSeen, confirm the missed tail replays ---
  const leg2 = openAgentSocket(cfg, sessionId);
  await waitForOpen(leg2.ws);
  sendJson(leg2.ws, { event: 'client:hello', data: { last_seq: lastSeqSeen, connection_uuid: 'contract-resume-2' } });
  const hello2 = await waitForMessage(leg2.messages, (m) => m.event === 'server:hello');
  expect(hello2.data.ack.ok).toBe(true);
  expect(hello2.data.ack.from_seq).toBe(lastSeqSeen);

  // replay_to() (backend/apps/agents/core/ws_manager.py) sends every replayed frame BEFORE
  // server:hello, so by the time server:hello has landed, the replay is already fully queued
  // in `messages` (or will land within the same tick) — collectUntil below just waits it out.
  const replayed = await collectUntil(leg2.messages, (m) => m.event === 'agent:status' && m.data?.status === 'completed');
  const replayedSeqEvents = replayed.filter((m) => typeof m.seq === 'number');

  expect(replayedSeqEvents.map((m) => m.seq)).toEqual(expectedReplay.map((m) => m.seq));
  expect(replayedSeqEvents.map((m) => m.event)).toEqual(expectedReplay.map((m) => m.event));
  leg2.ws.close();
});

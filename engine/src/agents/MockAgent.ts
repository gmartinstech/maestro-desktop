// engine/src/agents/MockAgent.ts -- AGT-3, a port of backend/apps/agents/manager/MockAgent.py.
//
// mockAgentEnabled() + runMockTurn() are the deterministic MAESTRO_MOCK_AGENT=1 seam (the one
// CLAUDE.md documents: "streams a deterministic synthetic reply with no key, CLI or network").
// This is the piece AGT-3's gate proves byte-identical against the real Python backend -- see
// docs/plans/txm-status.md's AGT-3 row for the exact driver scripts and diff result.
//
// runMockAgent() (the SDK-missing dev-fallback loop, `run_mock_agent` in the Python original) is
// ported too for completeness of "port MockAgent.py", but it is NOT gated: it parks on a real HITL
// approval round-trip (`ws_manager.send_approval_request` in Python), and no approval bridge exists
// in the engine yet (no real /ws/agents connection to send an `agent:approval_response` back over).
// Its `requestApproval` dependency is left as an explicit DI seam that throws until that bridge
// exists, rather than silently no-op'ing -- same "fail loudly, don't fake it" stance WIRE-1 took for
// a missing engine/dist/main.js.
//
// Session/message types come from `./core/models` (AGT-2's port of core/models.py), not a local
// copy -- see sessionFactory.ts's header for why (AGT-1/AGT-2 landed concurrently with this ticket;
// this file switched over once that port was confirmed stable rather than keep a duplicate
// AgentSession type alive in the same package).

import { uuidHex } from './uuid';
import { streamText } from './RunSupport';
import { wsManager } from './core/wsManager';
import { createMessage, toWireSession } from './sessionFactory';
import type { AgentSession, Message } from './core/models';

// AGT-4 reconciliation note (flagged by AGT-2's own header as left for "whoever picks up AGT-4/5"):
// this file now sends through `core/wsManager.ts`'s full `ConnectionManager` singleton (calling
// `wsManager.sendToSession(...)` directly, not a rebound local -- `.bind` loses the method's
// per-call generic inference, which is exactly what keeps each call site's `event`/`data` pair
// type-checked against contract/ws/agents.ts), the same singleton AGT-4's new streaming/run modules
// use, instead of the flat `agents/wsManager.ts` placeholder AGT-3 wrote before AGT-2 landed. The
// flat `wsManager.ts` + `seqLog.ts` files are deleted as part of this same change (nothing else
// imports them) so there is exactly one send_to_session-equivalent in the engine, not two silently
// coexisting ones.

// Obviously-synthetic prefix so a mock reply can never be mistaken for a model reply, in a log or
// in the UI -- mirrors MockAgent.py's MOCK_REPLY_PREFIX exactly (tests assert on it there; do the
// same here).
export const MOCK_REPLY_PREFIX = '[maestro-mock] echo: ';

/** True when MAESTRO_MOCK_AGENT=1 selects the deterministic no-credential agent. Mirrors
 * mock_agent_enabled(): only the exact string "1" counts (this codebase's opt-in-flag convention),
 * read per call (not cached at import) so a test can flip process.env between calls. */
export function mockAgentEnabled(): boolean {
  return process.env.MAESTRO_MOCK_AGENT === '1';
}

/** The MAESTRO_MOCK_AGENT=1 turn: stream one deterministic synthetic assistant reply through the
 * same streamText + agent:message path the real loop will use, with no key, no CLI spawn, and no
 * network. Mirrors run_mock_turn field-for-field, including the `delay: 0.0` comment's reasoning
 * (a smoke/test shouldn't pay per-word pacing). `sessions` is the same Map<string, AgentSession>
 * the caller's whole session store is -- passed in, not held on an instance, per this ticket's
 * plain-function DI pattern (see engine/src/router/process.ts's header for the same convention). */
export async function runMockTurn(sessions: Map<string, AgentSession>, sessionId: string, prompt: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.status = 'running';
  const asstText = `${MOCK_REPLY_PREFIX}${prompt}`;
  const asstMsgId = uuidHex();
  await streamText(sessionId, asstMsgId, asstText, 0.0);
  const asstMsg: Message = createMessage({
    id: asstMsgId,
    role: 'assistant',
    content: asstText,
    branch_id: session.active_branch_id,
    // Fair, documented exception (see the ticket's own gate instructions): the real backend has no
    // way to inject this value either (Message.timestamp defaults to datetime.now() with no
    // override in MockAgent.py), so both implementations produce a live wall-clock value here that
    // cannot be pinned without editing the reference file this ticket is forbidden from touching.
    timestamp: new Date().toISOString(),
  });
  session.messages.push(asstMsg);
  await wsManager.sendToSession(sessionId, 'agent:message', {
    session_id: sessionId,
    message: { ...asstMsg },
  });
  session.status = 'completed';
  await wsManager.sendToSession(sessionId, 'agent:status', {
    session_id: sessionId,
    status: 'completed',
    // message_index is an in-process lookup cache (pydantic exclude=True on the Python side) --
    // never belongs on the wire; toWireSession strips it. See sessionFactory.ts's header.
    session: toWireSession(session),
  });
}

/** Dependency the real (unimplemented) HITL approval round-trip needs; see this file's header.
 * Thrown by the default until a real /ws/agents approval bridge exists in the engine. */
export type RequestApproval = (sessionId: string, requestId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<{ behavior: 'allow' | 'deny' }>;

const notImplementedRequestApproval: RequestApproval = async () => {
  throw new Error(
    'runMockAgent: no HITL approval bridge exists in the engine yet (ws_manager.send_approval_request has no port) -- ' +
      'pass a requestApproval implementation once one does, rather than relying on this default.',
  );
};

/** Mock agent loop for development without the SDK installed -- mirrors run_mock_agent's shape
 * (approval request -> tool call -> tool result -> assistant reply), with `requestApproval` as the
 * one seam that can't be faithfully ported yet (see header). NOT part of AGT-3's gate. */
export async function runMockAgent(sessions: Map<string, AgentSession>, sessionId: string, prompt: string, requestApproval: RequestApproval = notImplementedRequestApproval): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const requestId = uuidHex();
  const command = `echo 'Processing: ${prompt}'`;
  session.status = 'waiting_approval';
  await wsManager.sendToSession(sessionId, 'agent:status', {
    session_id: sessionId,
    status: 'waiting_approval',
  });

  const decision = await requestApproval(sessionId, requestId, 'Bash', {
    command,
    description: 'Echo the user prompt',
  });

  session.status = 'running';
  await wsManager.sendToSession(sessionId, 'agent:status', {
    session_id: sessionId,
    status: 'running',
  });

  const toolMsgId = uuidHex();
  const inputJson = JSON.stringify({ command }, null, 2);
  await streamToolInput(sessionId, toolMsgId, 'Bash', inputJson);
  const toolMsg: Message = createMessage({
    id: toolMsgId,
    role: 'tool_call',
    content: { tool: 'Bash', input: { command }, approved: decision.behavior === 'allow' },
    branch_id: session.active_branch_id,
    timestamp: new Date().toISOString(),
  });
  session.messages.push(toolMsg);
  await wsManager.sendToSession(sessionId, 'agent:message', {
    session_id: sessionId,
    message: { ...toolMsg },
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (decision.behavior === 'allow') {
    const toolResult: Message = createMessage({
      id: uuidHex(),
      role: 'tool_result',
      content: `Processing: ${prompt}`,
      branch_id: session.active_branch_id,
      timestamp: new Date().toISOString(),
    });
    session.messages.push(toolResult);
    await wsManager.sendToSession(sessionId, 'agent:message', {
      session_id: sessionId,
      message: { ...toolResult },
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const asstText =
    `I've processed your request: "${prompt}"\n\n` +
    'This is a mock response because `claude-agent-sdk` is not installed. ' +
    'Install it with `pip install claude-agent-sdk` to use real Claude Code instances.\n\n' +
    `The agent was configured with:\n- Model: ${session.model}\n- Mode: ${session.mode}`;
  const asstMsgId = uuidHex();
  await streamText(sessionId, asstMsgId, asstText);
  const asstMsg: Message = createMessage({
    id: asstMsgId,
    role: 'assistant',
    content: asstText,
    branch_id: session.active_branch_id,
    timestamp: new Date().toISOString(),
  });
  session.messages.push(asstMsg);
  await wsManager.sendToSession(sessionId, 'agent:message', {
    session_id: sessionId,
    message: { ...asstMsg },
  });

  session.status = 'completed';
  session.closed_at = new Date().toISOString();
  await wsManager.sendToSession(sessionId, 'agent:status', {
    session_id: sessionId,
    status: 'completed',
    // message_index is an in-process lookup cache (pydantic exclude=True on the Python side) --
    // never belongs on the wire; toWireSession strips it. See sessionFactory.ts's header.
    session: toWireSession(session),
  });
  await wsManager.sendToSession(sessionId, 'agent:cost_update', {
    session_id: sessionId,
    cost_usd: session.cost_usd,
  });
}

/** Mirrors RunSupport.stream_tool_input -- only runMockAgent uses it, so it lives here rather than
 * RunSupport.ts (which only ports what runMockTurn, the gated path, needs). */
async function streamToolInput(sessionId: string, msgId: string, toolName: string, inputJson: string, delay = 0.02): Promise<void> {
  await wsManager.sendToSession(sessionId, 'agent:stream_start', {
    session_id: sessionId,
    message_id: msgId,
    role: 'tool_call',
    tool_name: toolName,
  });
  const chunkSize = 12;
  for (let i = 0; i < inputJson.length; i += chunkSize) {
    await wsManager.sendToSession(sessionId, 'agent:stream_delta', {
      session_id: sessionId,
      message_id: msgId,
      delta: inputJson.slice(i, i + chunkSize),
    });
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
  }
  await wsManager.sendToSession(sessionId, 'agent:stream_end', {
    session_id: sessionId,
    message_id: msgId,
  });
}

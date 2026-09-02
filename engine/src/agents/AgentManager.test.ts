// engine/src/agents/AgentManager.test.ts -- AGT-3. Proves the seam ordering itself: with
// MAESTRO_MOCK_AGENT=1, runAgentLoop must reach the mock branch and return WITHOUT ever reaching
// the real-path throw below it -- i.e. a mock turn is unreachable-past the check, mirroring
// agent_manager.py's run_agent_loop placing mock_agent_enabled() ahead of build_agent_options.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentManager, runAgentLoop } from './AgentManager';
import { createAgentSession, createMessageBranch } from './sessionFactory';
import type { AgentConfig, AgentSession } from './core/models';
import { DEFAULT_ALLOWED_TOOLS } from './core/models';

// AGT-4: this test doesn't inspect any emitted WS event, only session.status -- no fake socket
// registration is needed against core/wsManager.ts's ConnectionManager singleton (the flat
// wsManager.ts/seqLog.ts placeholders these lines used to reset are deleted; see MockAgent.ts's
// header for the reconciliation).
describe('runAgentLoop seam ordering', () => {
  const sessionId = 'sess-seam-1';
  let sessions: Map<string, AgentSession>;
  const originalFlag = process.env.MAESTRO_MOCK_AGENT;

  beforeEach(() => {
    sessions = new Map();
    sessions.set(
      sessionId,
      createAgentSession({
        id: sessionId,
        name: 'seam test',
        created_at: '2026-01-01T00:00:00',
        branches: { main: createMessageBranch({ id: 'main', created_at: '2026-01-01T00:00:00' }) },
      }),
    );
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.MAESTRO_MOCK_AGENT;
    else process.env.MAESTRO_MOCK_AGENT = originalFlag;
  });

  it('MAESTRO_MOCK_AGENT=1 resolves via the mock turn and completes the session, never reaching the real-path throw', async () => {
    process.env.MAESTRO_MOCK_AGENT = '1';
    await expect(runAgentLoop(sessions, sessionId, 'hi')).resolves.toBeUndefined();
    expect(sessions.get(sessionId)!.status).toBe('completed');
  });

  it('with the flag unset, the (unported) real path throws rather than silently no-op-ing', async () => {
    delete process.env.MAESTRO_MOCK_AGENT;
    await expect(runAgentLoop(sessions, sessionId, 'hi')).rejects.toThrow(/not yet implemented/);
    // And the throw happens before any mutation -- status is untouched.
    expect(sessions.get(sessionId)!.status).toBe('running');
  });

  it('an unknown session is a silent no-op regardless of the flag (mirrors the Python "if not session: return")', async () => {
    process.env.MAESTRO_MOCK_AGENT = '1';
    await expect(runAgentLoop(sessions, 'no-such-session', 'hi')).resolves.toBeUndefined();
  });
});

// AGT-6: the stateful class this ticket adds on top of the seam above -- launchAgent/sendMessage/
// stopAgent wired together the same way engine/src/agents/http.ts and ws.ts wire them into a real
// request. A fresh AgentManager instance per test (not the process-wide `agentManager` singleton)
// keeps these isolated from anything else touching that singleton.
function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'agent-manager test',
    model: 'sonnet',
    mode: 'agent',
    provider: 'anthropic',
    system_prompt: null,
    allowed_tools: [...DEFAULT_ALLOWED_TOOLS],
    max_turns: null,
    target_directory: null,
    dashboard_id: null,
    workflow_run_id: null,
    workflow_edit_id: null,
    selected_app_output_ids: null,
    initial_message: null,
    ...overrides,
  };
}

describe('AgentManager (class): launch -> send message -> mock turn wiring', () => {
  let workDir: string;
  const originalFlag = process.env.MAESTRO_MOCK_AGENT;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'maestro-agent-manager-test-'));
    process.env.MAESTRO_MOCK_AGENT = '1';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.MAESTRO_MOCK_AGENT;
    else process.env.MAESTRO_MOCK_AGENT = originalFlag;
    rmSync(workDir, { recursive: true, force: true });
  });

  it('launchAgent registers a running session in .sessions', async () => {
    const manager = new AgentManager();
    const session = await manager.launchAgent(agentConfig({ target_directory: workDir }));
    expect(manager.getSession(session.id)).toBe(session);
    expect(session.status).toBe('running');
  });

  it('sendMessage spawns a tracked task that settles once the mock turn completes', async () => {
    const manager = new AgentManager();
    const session = await manager.launchAgent(agentConfig({ target_directory: workDir }));

    const delivered = await manager.sendMessage(session.id, 'hello');
    expect(delivered).toBe(true);

    const deadline = Date.now() + 2_000;
    while (manager.activeCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(manager.activeCount()).toBe(0);
    expect(session.status).toBe('completed');
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('a second sendMessage while one is still running is refused (delivered: false)', async () => {
    const manager = new AgentManager();
    const session = await manager.launchAgent(agentConfig({ target_directory: workDir }));
    // A task that never reports done() -- simulates "still running" without racing the real
    // (near-instant) mock turn.
    manager.tasks.set(session.id, { cancel: () => {}, done: () => false });

    const delivered = await manager.sendMessage(session.id, 'second message');
    expect(delivered).toBe(false);
  });

  it('stopAgent flips status to stopped and clears the task registry', async () => {
    const manager = new AgentManager();
    const session = await manager.launchAgent(agentConfig({ target_directory: workDir }));
    manager.tasks.set(session.id, { cancel: () => {}, done: () => false });

    await manager.stopAgent(session.id);

    expect(session.status).toBe('stopped');
    expect(manager.tasks.has(session.id)).toBe(false);
  });
});

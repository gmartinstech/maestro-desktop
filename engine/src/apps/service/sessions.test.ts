import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { computeCostBreakdown, computeUsageSummary, loadAllSessions, sessionsDir } from './sessions';

let dataRoot: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'maestro-service-sessions-'));
  env = { ...process.env, MAESTRO_DATA_ROOT: dataRoot };
  mkdirSync(sessionsDir(env), { recursive: true });
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

function writeSession(name: string, data: Record<string, unknown>): void {
  writeFileSync(join(sessionsDir(env), name), JSON.stringify(data), 'utf8');
}

describe('sessionsDir / loadAllSessions', () => {
  test('an absent sessions dir yields an empty list, not a throw', () => {
    rmSync(sessionsDir(env), { recursive: true, force: true });
    expect(loadAllSessions(env)).toEqual([]);
  });

  test('reads every *.json file, ignoring non-json files', () => {
    writeSession('a.json', { model: 'x' });
    writeFileSync(join(sessionsDir(env), 'notes.txt'), 'ignore me', 'utf8');
    expect(loadAllSessions(env)).toHaveLength(1);
  });

  test('a corrupt session file is skipped, not fatal to the whole load', () => {
    writeSession('good.json', { model: 'x', cost_usd: 1 });
    writeFileSync(join(sessionsDir(env), 'bad.json'), '{ not json', 'utf8');
    expect(loadAllSessions(env)).toHaveLength(1);
  });
});

describe('computeUsageSummary', () => {
  test('an empty sessions dir yields all-zero totals, not a throw', () => {
    const summary = computeUsageSummary(env);
    expect(summary.total_sessions).toBe(0);
    expect(summary.cost_source).toBe('none');
    expect(summary.nine_router_available).toBe(false);
  });

  test('a draft session with no cost/tokens/active-time/assistant-turn is excluded', () => {
    writeSession('draft.json', { model: 'x', status: 'active', messages: [{ role: 'user' }] });
    expect(computeUsageSummary(env).total_sessions).toBe(0);
  });

  test('a session counts as real via cost_usd alone', () => {
    writeSession('s1.json', { model: 'claude', provider: 'anthropic', cost_usd: 0.5, status: 'completed', messages: [] });
    const summary = computeUsageSummary(env);
    expect(summary.total_sessions).toBe(1);
    expect(summary.total_cost_usd).toBeCloseTo(0.5);
    expect(summary.cost_source).toBe('sdk');
    expect(summary.completion_rate).toBe(1);
  });

  test('a session counts as real via an assistant message alone', () => {
    writeSession('s1.json', { model: 'x', messages: [{ role: 'user' }, { role: 'assistant' }] });
    expect(computeUsageSummary(env).total_sessions).toBe(1);
  });

  test('tool_latencies wins over sparse tool_call messages when it counts more', () => {
    writeSession('s1.json', {
      model: 'x',
      cost_usd: 1,
      messages: [{ role: 'tool_call', content: { tool: 'bash' } }],
      tool_latencies: { bash: { count: 3 }, grep: { count: 2 } },
    });
    const summary = computeUsageSummary(env);
    expect(summary.total_tool_calls).toBe(5);
    expect(summary.top_tools).toEqual({ bash: 3, grep: 2 });
  });

  test('message-derived tool counts win when they exceed tool_latencies', () => {
    writeSession('s1.json', {
      model: 'x',
      cost_usd: 1,
      messages: [
        { role: 'tool_call', content: { tool: 'bash' } },
        { role: 'tool_call', content: { tool: 'bash' } },
      ],
      tool_latencies: { bash: { count: 1 } },
    });
    expect(computeUsageSummary(env).total_tool_calls).toBe(2);
  });

  test('run seconds fall back to created_at/closed_at wall-clock when agent_active_ms is absent', () => {
    writeSession('s1.json', {
      model: 'x',
      cost_usd: 1,
      created_at: '2026-01-01T00:00:00',
      closed_at: '2026-01-01T00:01:00',
      messages: [],
    });
    const summary = computeUsageSummary(env);
    expect(summary.total_run_seconds).toBe(60);
    expect(summary.avg_duration_seconds).toBe(60);
  });

  test('models_used/providers_used/status_breakdown tally across multiple sessions', () => {
    writeSession('s1.json', { model: 'claude', provider: 'anthropic', status: 'completed', cost_usd: 1, messages: [] });
    writeSession('s2.json', { model: 'claude', provider: 'anthropic', status: 'error', cost_usd: 1, messages: [] });
    const summary = computeUsageSummary(env);
    expect(summary.models_used).toEqual({ claude: 2 });
    expect(summary.providers_used).toEqual({ anthropic: 2 });
    expect(summary.status_breakdown).toEqual({ completed: 1, error: 1 });
    expect(summary.completion_rate).toBeCloseTo(0.5);
  });
});

describe('computeCostBreakdown', () => {
  test('always reports unavailable -- 9Router stats are not wired up in this ticket (see header)', () => {
    expect(computeCostBreakdown()).toEqual({ available: false, by_model: {}, by_provider: {} });
  });
});

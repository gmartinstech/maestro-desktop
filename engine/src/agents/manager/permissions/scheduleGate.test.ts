// engine/src/agents/manager/permissions/scheduleGate.test.ts -- AGT-5. Ports
// backend/tests/test_schedule_gate.py case-for-case: the always-on maestro-schedule MCP must never
// fall through to always_allow (its committing tools force an approval and Claude's internal
// Cron* tools are denied, even when the user set everything to always_allow).

import { describe, expect, it } from 'vitest';
import { maybeOverridePolicy } from './pathGate';
import { isClaudeScheduleSkill } from './workflowApproval';

describe('schedule gate (ports test_schedule_gate.py)', () => {
  it('the schedule-commit MCP tools force ask even when always_allow', () => {
    for (const tool of [
      'mcp__maestro-schedule__ScheduleWorkflow',
      'mcp__maestro-schedule__UpdateScheduledWorkflow',
      'mcp__maestro-schedule__DeleteScheduledWorkflow',
      'mcp__maestro-schedule__PauseAllWorkflows',
    ]) {
      const [policy] = maybeOverridePolicy('always_allow', tool, {});
      expect(policy, `${tool} must force an approval, not silently always_allow`).toBe('ask');
    }
  });

  it('RemoteTrigger forces ask even when always_allow', () => {
    // RemoteTrigger is the CLI's own scheduler (create/update/run routines through the claude.ai
    // API): unattended recurring execution, so it goes through ApprovalBar like the native
    // schedule tools.
    for (const action of ['create', 'update', 'run', 'list']) {
      const [policy] = maybeOverridePolicy('always_allow', 'RemoteTrigger', { action });
      expect(policy, `RemoteTrigger ${action} must force an approval, not silently always_allow`).toBe('ask');
    }
  });

  it("Claude's internal Cron tools are denied", () => {
    for (const tool of ['CronCreate', 'CronList', 'CronDelete']) {
      const [policy] = maybeOverridePolicy('always_allow', tool, {});
      expect(policy, `${tool} must be denied in favour of the native scheduler`).toBe('deny');
    }
  });

  it('detects the Claude internal schedule skill', () => {
    expect(isClaudeScheduleSkill('Skill', { skill: 'schedule' })).toBe(true);
    expect(isClaudeScheduleSkill('Skill', { skill: 'Schedule' })).toBe(true);
    expect(isClaudeScheduleSkill('Skill', { skill: 'other' })).toBe(false);
    expect(isClaudeScheduleSkill('Bash', { skill: 'schedule' })).toBe(false);
    expect(isClaudeScheduleSkill('Skill', 'not a dict')).toBe(false);
  });

  it('a normal tool is unaffected by the schedule gate', () => {
    const [policy] = maybeOverridePolicy('always_allow', 'Read', {});
    expect(policy).toBe('always_allow');
  });
});

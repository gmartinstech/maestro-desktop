// engine/src/apps/workflows/escalation.test.ts -- SUB-7's vitest twin of
// backend/tests/test_workflows_semantics.py's escalation cases.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as escalation from './escalation';
import { newWorkflow, newWorkflowRun, newPermissionTier } from './models';

beforeEach(() => {
  escalation.resetForTest();
});

afterEach(() => {
  escalation.resetForTest();
});

describe('schedule / cancel', () => {
  test('schedules a second tier and ack (cancel) clears its state', async () => {
    const wf = {
      ...newWorkflow(),
      title: 't',
      permissions: [newPermissionTier({ kind: 'notify' }), newPermissionTier({ kind: 'text', after_minutes: 60, phone: '+15551234567' })],
    };
    const run = newWorkflowRun({ workflow_id: wf.id, status: 'success' });
    escalation.schedule(wf, run);
    await new Promise((r) => setTimeout(r, 10));
    expect(escalation.status(run.id)).not.toBeNull();
    expect(escalation.cancel(run.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(escalation.status(run.id)).toBeNull();
  });

  test('is a no-op for a workflow with only the default notify tier', () => {
    const wf = { ...newWorkflow(), title: 't', permissions: [newPermissionTier({ kind: 'notify' })] };
    const run = newWorkflowRun({ workflow_id: wf.id, status: 'success' });
    escalation.schedule(wf, run);
    expect(escalation.status(run.id)).toBeNull();
  });

  test('cancel on an unknown run id returns false', () => {
    expect(escalation.cancel('does-not-exist')).toBe(false);
  });

  test('fires the tier via notifier.sendTier once its delay elapses', async () => {
    vi.useFakeTimers();
    const notifier = await import('./notifier');
    const sendTierSpy = vi.spyOn(notifier, 'sendTier').mockResolvedValue(undefined);
    const wf = {
      ...newWorkflow(),
      title: 't',
      permissions: [newPermissionTier({ kind: 'notify' }), newPermissionTier({ kind: 'text', after_minutes: 1, phone: '+15551234567' })],
    };
    const run = newWorkflowRun({ workflow_id: wf.id, status: 'success' });
    escalation.schedule(wf, run);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendTierSpy).toHaveBeenCalledTimes(1);
    sendTierSpy.mockRestore();
    vi.useRealTimers();
  });
});

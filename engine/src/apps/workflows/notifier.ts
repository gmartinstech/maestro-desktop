// engine/src/apps/workflows/notifier.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/notifier.py: the permission/escalation chain notifier. The notify tier
// broadcasts a ws event the renderer picks up; the text/call tiers fall back to an extra ws notify
// with a `fallback: true` marker until the cloud SMS bridge ships (unchanged from the Python
// original -- that bridge still doesn't exist).

import { wsManager } from '../../agents/core/wsManager';
import * as escalation from './escalation';
import type { PermissionTier, Workflow, WorkflowRun } from './models';

function basePayload(wf: Workflow, run: WorkflowRun): Record<string, unknown> {
  return {
    workflow_id: wf.id,
    workflow_title: wf.title,
    run_id: run.id,
    status: run.status,
    session_id: run.session_id,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

export async function notifyRunComplete(wf: Workflow, run: WorkflowRun): Promise<void> {
  const payload = basePayload(wf, run);
  await wsManager.broadcastGlobal('workflow:notify', payload);
  // Kick off server-side escalation only if there are additional tiers beyond the default notify.
  escalation.schedule(wf, run);
}

export async function sendTier(wf: Workflow, run: WorkflowRun, tier: PermissionTier): Promise<void> {
  const payload = basePayload(wf, run);
  payload.tier_kind = tier.kind;
  payload.tier_phone = tier.phone ? tier.phone.slice(-4) : null;
  payload.fallback = true; // flip to false once the cloud SMS bridge is wired
  await wsManager.broadcastGlobal('workflow:notify', payload);
}

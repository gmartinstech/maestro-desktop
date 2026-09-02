// engine/src/apps/workflows/escalation.ts -- SUB-7, a full TypeScript port of
// backend/apps/workflows/escalation.py: server-side escalation timer for the permission chain
// (notify -> text -> call). State lives in module-scoped maps, not on disk -- a restart mid-
// escalation loses the chain on purpose (see the Python original's own header for why).

import type { PermissionTier, Workflow, WorkflowRun } from './models';
import { sendTier } from './notifier';

interface EscalationState {
  tier_idx: number;
  tier_kind: string;
  next_at: string;
}

// run_id -> escalation timer handle + its cancellation flag (Node has no asyncio.Task to .cancel(),
// so a plain boolean flag checked between awaits stands in for CancelledError).
const timers = new Map<string, { cancelled: boolean }>();
const state = new Map<string, EscalationState>();

// Tier minutes/hours convention matches the FE: text uses minutes, call uses hours. Translated at
// the boundary so the math below is always in seconds -- mirrors escalation.py's _tier_delay_seconds.
function tierDelaySeconds(tier: PermissionTier): number {
  if (tier.kind === 'call') return Math.max(0, tier.after_minutes) * 3600;
  return Math.max(0, tier.after_minutes) * 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

async function runner(wf: Workflow, run: WorkflowRun, tiers: PermissionTier[], handle: { cancelled: boolean }): Promise<void> {
  try {
    // Tier 0 is the initial notify; walk 1..N, sleeping the tier's delay before sending. An /ack
    // call flips handle.cancelled, which this loop checks after every sleep/send.
    for (let idx = 1; idx < tiers.length; idx++) {
      if (handle.cancelled) return;
      const tier = tiers[idx];
      const delayMs = tierDelaySeconds(tier) * 1000;
      const fireAt = new Date(Date.now() + delayMs);
      state.set(run.id, { tier_idx: idx, tier_kind: tier.kind, next_at: fireAt.toISOString() });
      await sleep(delayMs);
      if (handle.cancelled) return;
      try {
        await sendTier(wf, run, tier);
      } catch {
        // Best-effort, mirrors the Python original's logged-and-continue.
      }
    }
  } finally {
    state.delete(run.id);
    timers.delete(run.id);
  }
}

/** Kick off escalation for a finished run. No-op if the workflow has only the default notify tier. */
export function schedule(wf: Workflow, run: WorkflowRun): void {
  const tiers = wf.permissions ?? [];
  if (tiers.length <= 1) return;
  cancel(run.id);
  const handle = { cancelled: false };
  timers.set(run.id, handle);
  void runner(wf, run, tiers, handle);
}

export function cancel(runId: string): boolean {
  const handle = timers.get(runId);
  timers.delete(runId);
  state.delete(runId);
  if (!handle) return false;
  handle.cancelled = true;
  return true;
}

export function status(runId: string): EscalationState | null {
  return state.get(runId) ?? null;
}

/** Test-only escape hatch: drops all in-flight escalation state so a test's global maps don't leak
 * into the next one. */
export function resetForTest(): void {
  for (const handle of timers.values()) handle.cancelled = true;
  timers.clear();
  state.clear();
}

// engine/src/apps/swarm/entities/workflowExportable.ts -- SUB-3, a DELIBERATE SCOPE-CUT stand-in
// for backend/apps/swarm/entities/workflows.py's WorkflowExportable.
//
// backend/apps/workflows (the scheduled-task/workflow feature -- SUB-7 in this migration's own
// work queue) has not been ported to the engine yet. workflows.py's OWN module doc already treats
// this exact situation as expected, not exceptional -- its store lookups (p_store()/p_model()) are
// wrapped in try/except and documented as lazy: "on a build without it, export finds nothing and
// import fails with a clear message, and the module still imports cleanly. It lights up the moment
// the workflow forward-port lands." This file reproduces that same shape natively: load() returns
// null (so no workflow can ever appear in a bundle's dependency closure yet), import_() throws a
// clear BundleError. sanitizeWorkflow() (the schedule-disarm / phone-number-strip PII scrub) is
// still ported in full below even though nothing calls it yet, so the moment SUB-7 lands a real
// store, only load()/import_() need replacing -- the actual sanitization logic (the
// security/privacy-relevant part) is already faithful and ready.

import type { DepRef, Exportable, ExportContext } from '../exportable';
import type { RemapTable } from '../exportable';
import { EntityType, type Requirement } from '../models';
import { BundleError } from '../ziputil';

// Run-state, machine-linkage, and identifiers that must not ride along.
const P_DROP_FIELDS = new Set([
  'id', 'source_session_id', 'dashboard_id', 'edit_agent_session_id',
  'last_run_at', 'last_run_status', 'last_run_id', 'next_run_at',
  'created_at', 'updated_at', 'cost_cap_usd_monthly',
]);

/** Full port of workflows.py's sanitize_workflow: an imported workflow must never silently start
 * running on someone else's machine, so the schedule is forced off (the importer re-arms it); the
 * sharer's phone numbers (text/call escalation) are stripped as PII. */
export function sanitizeWorkflow(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!P_DROP_FIELDS.has(k)) out[k] = v;
  }
  const sched = out.schedule;
  if (sched && typeof sched === 'object') {
    out.schedule = { ...(sched as Record<string, unknown>), enabled: false, runs_count: 0, next_run_at: null, ends_at: null };
  }
  const perms = out.permissions;
  if (Array.isArray(perms) && perms.length > 0) {
    out.permissions = perms.map((tier) => (tier && typeof tier === 'object' ? { ...(tier as Record<string, unknown>), phone: null } : tier));
  }
  return out;
}

export class WorkflowExportable implements Exportable {
  readonly type = EntityType.workflow;
  readonly localId: string = '';
  readonly name: string = '';

  static load(_localId: string): WorkflowExportable | null {
    return null;
  }

  serialize(_ctx: ExportContext): Record<string, unknown> {
    return {};
  }

  files(): Record<string, Buffer> {
    return {};
  }

  dependencies(): DepRef[] {
    return [];
  }

  // Unreachable in practice today: load() always returns null (see this file's header), so no
  // instance of this class is ever actually constructed to call requirements() on. Kept as a
  // trivial [] rather than a real port of workflows.py's mcp_action/builtin_mode/api_key
  // requirement-building, which has nothing real to read from yet -- SUB-7 should port that
  // alongside a real load()/store.
  requirements(): Requirement[] {
    return [];
  }

  static import_(_payload: Record<string, unknown>, _files: Record<string, Buffer>, _remap: RemapTable | null): string {
    throw new BundleError("this build doesn't support workflows yet; please update Maestro");
  }
}

import type { State, WorkflowRun } from './workflowsTypes';
import type { ActiveRun } from './workflowsTypes';

export function mergeRunIntoState(state: State, r: WorkflowRun) {
  const arr = state.runs[r.workflow_id] || [];
  const idx = arr.findIndex((x) => x.id === r.id);
  const prev = idx >= 0 ? arr[idx] : null;
  if (idx >= 0) arr[idx] = r; else arr.unshift(r);
  state.runs[r.workflow_id] = arr.slice(0, 100);
  // Keep the cross-workflow log (Scheduled tasks history tab) live without a refetch.
  const aIdx = state.allRuns.findIndex((x) => x.id === r.id);
  if (aIdx >= 0) state.allRuns[aIdx] = r; else state.allRuns.unshift(r);
  state.allRuns.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  state.allRuns = state.allRuns.slice(0, 200);
  const pending = state.runControlPending[r.id];
  if (
    (pending === 'pause' && r.paused) ||
    (pending === 'resume' && !r.paused) ||
    (pending === 'stop' && r.status !== 'running')
  ) {
    delete state.runControlPending[r.id];
  }
  const wf = state.items[r.workflow_id];
  if (wf) {
    wf.last_run_at = r.finished_at || r.started_at;
    wf.last_run_status = r.status === 'skipped' ? wf.last_run_status : (r.status as typeof wf.last_run_status);
    wf.last_run_id = r.id;
  }
  // Keep the live "Ongoing runs" list in sync off the WS stream: a run that's no longer running drops out of `active`, a freshly-running one joins. Without this, `active` only refreshed on the one-shot mount fetch, so finished runs lingered as "Working…" while the monitor already showed them done.
  const activeIdx = state.active.findIndex((a) => a.run_id === r.id);
  if (r.status === 'running') {
    const entry: ActiveRun = { workflow_id: r.workflow_id, run_id: r.id, title: wf?.title || '', started_at: r.started_at };
    if (activeIdx >= 0) state.active[activeIdx] = entry; else state.active.unshift(entry);
  } else if (activeIdx >= 0) {
    state.active.splice(activeIdx, 1);
  }
  // Auto-flip the card view on run state transitions so the user sees Running while it streams, Completed on success, Failed on failure. Only nudge from views that the user hasn't actively navigated away from (saved / running). Edit, history, scheduling etc. stay put.
  const card = state.openCards[r.workflow_id];
  // A scheduled run flipping into 'running' fired unattended, so nudge the user with a clickable toast. Only on the into-running edge (not every tool-label/step bump), and only for schedule (manual runs they kicked off themselves don't need a "surprise, it's running" popup).
  if (r.status === 'running' && r.triggered_by === 'schedule' && (!prev || prev.status !== 'running')) {
    state.runningToast = {
      workflowId: r.workflow_id,
      runId: r.id,
      workflowTitle: state.items[r.workflow_id]?.title || 'Workflow',
    };
  }
  if (card) {
    const fromRunnable = card.view === 'saved' || card.view === 'running';
    if (r.status === 'running' && fromRunnable) {
      card.view = 'running';
      card.runId = r.id;
    } else if (prev && prev.status === 'running' && r.status === 'success' && (card.view === 'running' || card.view === 'saved')) {
      card.view = 'completed';
      card.runId = r.id;
    } else if (prev && prev.status === 'running' && r.status === 'failure' && (card.view === 'running' || card.view === 'saved')) {
      card.view = 'failed';
      card.runId = r.id;
    }
    // A run that finishes while the user is watching it live becomes a "viewing" link so the sibling chat stays open with Stop Viewing, not a stale "watching" arrow pointing at a finished run.
    if (card.sidecarSessionId && card.sidecarKind === 'watching' && prev && prev.status === 'running') {
      if (r.status === 'failure') card.sidecarKind = 'viewing-error';
      else if (r.status === 'success' || r.status === 'ran_late') card.sidecarKind = 'viewing-completed';
    }
  }
}

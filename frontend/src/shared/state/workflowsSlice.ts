import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { mergeRunIntoState } from './workflowsRunHelpers';
import { initialState } from './workflowsTypes';
import type { OpenCard, State, Workflow, WorkflowRun } from './workflowsTypes';
import {
  ackRun,
  commitDraft,
  controlWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  discardDraft,
  fetchActiveRuns,
  fetchAllRuns,
  fetchCloudSmsStatus,
  fetchDeletedWorkflows,
  fetchPausedState,
  fetchRuns,
  fetchWorkflows,
  generateWorkflowMetadata,
  purgeWorkflow,
  restoreWorkflow,
  runWorkflowNow,
  setPausedAll,
  updateWorkflow,
} from './workflowsThunks';
import type { GeneratedMetadata } from './workflowsThunks';

export type {
  PermissionKind,
  PermissionTier,
  ScheduleConfig,
  CostEstimate,
  ActiveRun,
  ActionsConfig,
  WorkflowStep,
  Workflow,
  WorkflowRun,
  WorkflowRunControlAction,
  OpenCard,
  RunningToast,
} from './workflowsTypes';
export {
  ackRun,
  commitDraft,
  controlWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  discardDraft,
  fetchActiveRuns,
  fetchAllRuns,
  fetchCloudSmsStatus,
  fetchDeletedWorkflows,
  fetchPausedState,
  fetchRuns,
  fetchWorkflows,
  generateWorkflowMetadata,
  purgeWorkflow,
  restoreWorkflow,
  runWorkflowNow,
  setPausedAll,
  updateWorkflow,
};
export type { GeneratedMetadata };

// Merge preview-time generated metadata into a draft card, filling only the fields the user hasn't typed into so a rename mid-flight survives.
export const applyGeneratedMetadata = createAsyncThunk(
  'workflows/applyGeneratedMetadata',
  async (arg: { workflowId: string; meta: GeneratedMetadata }, { getState, dispatch }) => {
    const state = getState() as { workflows: State };
    const card = state.workflows.openCards[arg.workflowId];
    if (!card) return;
    const draft = (card.draft || {}) as Partial<Workflow>;
    const { meta } = arg;
    const steps = draft.steps || [];
    const nextDraft: Partial<Workflow> = { ...draft };
    let changed = false;
    if (meta.step_labels && meta.step_labels.length === steps.length) {
      nextDraft.steps = steps.map((s, i) => (meta.step_labels[i] ? { ...s, label: meta.step_labels[i] } : s));
      changed = true;
    }
    const hasTitle = Boolean(meta.title && meta.title.trim());
    if (hasTitle && !(draft.title || '').trim()) { nextDraft.title = meta.title; changed = true; }
    if (meta.description && meta.description.trim() && !(draft.description || '').trim()) {
      nextDraft.description = meta.description;
      changed = true;
    }
    const patch: Partial<OpenCard> = { metaLoading: false, metaGenerated: hasTitle };
    if (changed) patch.draft = nextDraft;
    dispatch(updateWorkflowCard({ workflowId: arg.workflowId, patch }));
  },
);

const slice = createSlice({
  name: 'workflows',
  initialState,
  reducers: {
    openWorkflowCard(state, action: { payload: OpenCard }) {
      state.openCards[action.payload.workflowId] = action.payload;
    },
    updateWorkflowCard(state, action: { payload: { workflowId: string; patch: Partial<OpenCard> } }) {
      const existing = state.openCards[action.payload.workflowId];
      if (existing) state.openCards[action.payload.workflowId] = { ...existing, ...action.payload.patch };
    },
    closeWorkflowCard(state, action: { payload: string }) {
      delete state.openCards[action.payload];
    },
    rekeyOpenCard(state, action: { payload: { oldId: string; newId: string } }) {
      const entry = state.openCards[action.payload.oldId];
      if (!entry) return;
      delete state.openCards[action.payload.oldId];
      state.openCards[action.payload.newId] = { ...entry, workflowId: action.payload.newId };
    },
    upsertRun(state, action: { payload: WorkflowRun }) {
      mergeRunIntoState(state, action.payload);
    },
    toggleExpandedStep(state, action: { payload: { workflowId: string; stepId: string } }) {
      const card = state.openCards[action.payload.workflowId];
      if (!card) return;
      const arr = card.expandedStepIds || [];
      const has = arr.includes(action.payload.stepId);
      card.expandedStepIds = has ? arr.filter((x) => x !== action.payload.stepId) : [...arr, action.payload.stepId];
    },
    setCardSidecar(state, action: { payload: { workflowId: string; sessionId: string | null; kind: OpenCard['sidecarKind'] } }) {
      const card = state.openCards[action.payload.workflowId];
      if (!card) return;
      card.sidecarSessionId = action.payload.sessionId;
      card.sidecarKind = action.payload.kind;
    },
    clearFixSeed(state, action: { payload: string }) {
      const card = state.openCards[action.payload];
      if (card) card.fixSeed = null;
    },
    // Live workflow changes pushed over WS (e.g. the Edit Agent's add/delete/edit-step tools). Keeps an open card in sync without a full refetch; idempotent, so a window receiving the echo of its own edit just re-sets the same data.
    upsertWorkflow(state, action: { payload: Workflow }) {
      state.items[action.payload.id] = action.payload;
    },
    removeWorkflow(state, action: { payload: string }) {
      delete state.items[action.payload];
      delete state.runs[action.payload];
      state.allRuns = state.allRuns.filter((r) => r.workflow_id !== action.payload);
    },
    dismissRunningToast(state) {
      state.runningToast = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWorkflows.pending, (state) => { state.loading = true; })
      .addCase(fetchWorkflows.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.items = {};
        for (const w of action.payload) state.items[w.id] = w;
      })
      .addCase(fetchWorkflows.rejected, (state) => { state.loading = false; state.loaded = true; })
      .addCase(createWorkflow.fulfilled, (state, action) => { state.items[action.payload.id] = action.payload; })
      // Optimistic: reflect the patch in the store immediately so store-driven UI (the schedule test-first banner, status, etc.) updates the instant the user edits, not after the PATCH round-trips (which awaits an aux relabel LLM call server-side). fulfilled overwrites with server truth; a 409 stale triggers a refetch in useWorkflowPatch.
      .addCase(updateWorkflow.pending, (state, action) => {
        const { id, patch } = action.meta.arg;
        const cur = state.items[id];
        if (cur) state.items[id] = { ...cur, ...patch };
      })
      .addCase(updateWorkflow.fulfilled, (state, action) => { state.items[action.payload.id] = action.payload; })
      .addCase(commitDraft.fulfilled, (state, action) => { state.items[action.payload.id] = action.payload; })
      .addCase(discardDraft.fulfilled, (state, action) => { state.items[action.payload.id] = action.payload; })
      .addCase(deleteWorkflow.fulfilled, (state, action) => {
        delete state.items[action.payload];
        delete state.runs[action.payload];
        state.allRuns = state.allRuns.filter((r) => r.workflow_id !== action.payload);
      })
      .addCase(runWorkflowNow.fulfilled, (state, action) => {
        // Enter the running view the moment the run kicks off, off the run_id the REST call returns. Don't wait for the workflow:run WS event: if it's missed or races the view, the Stop/Pause header never shows.
        const { id, run_id, status } = action.payload;
        const card = state.openCards[id];
        if (!card || !run_id || status !== 'running') return;
        if (['saved', 'running', 'completed', 'failed', 'history', 'history_detail'].includes(card.view)) {
          card.view = 'running';
          card.runId = run_id;
        }
      })
      .addCase(controlWorkflowRun.pending, (state, action) => {
        state.runControlPending[action.meta.arg.runId] = action.meta.arg.action;
      })
      .addCase(controlWorkflowRun.fulfilled, (state, action) => {
        if (action.payload.run) {
          mergeRunIntoState(state, action.payload.run);
        }
        if (action.payload.action !== 'stop') {
          delete state.runControlPending[action.payload.runId];
        } else if (action.payload.run && action.payload.run.status !== 'running') {
          delete state.runControlPending[action.payload.runId];
        }
      })
      .addCase(controlWorkflowRun.rejected, (state, action) => {
        delete state.runControlPending[action.meta.arg.runId];
      })
      .addCase(fetchRuns.fulfilled, (state, action) => {
        state.runs[action.payload.id] = action.payload.runs;
        for (const r of action.payload.runs) {
          const pending = state.runControlPending[r.id];
          if (
            (pending === 'pause' && r.paused) ||
            (pending === 'resume' && !r.paused) ||
            (pending === 'stop' && r.status !== 'running')
          ) {
            delete state.runControlPending[r.id];
          }
        }
      })
      .addCase(fetchAllRuns.pending, (state) => { state.allRunsLoading = true; })
      .addCase(fetchAllRuns.fulfilled, (state, action) => {
        state.allRunsLoading = false;
        state.allRuns = action.payload;
      })
      .addCase(fetchAllRuns.rejected, (state) => { state.allRunsLoading = false; })
      .addCase(fetchDeletedWorkflows.pending, (state) => { state.deletedLoading = true; })
      .addCase(fetchDeletedWorkflows.fulfilled, (state, action) => { state.deletedLoading = false; state.deleted = action.payload; })
      .addCase(fetchDeletedWorkflows.rejected, (state) => { state.deletedLoading = false; })
      .addCase(restoreWorkflow.fulfilled, (state, action) => {
        state.items[action.payload.id] = action.payload;
        state.deleted = state.deleted.filter((w) => w.id !== action.payload.id);
      })
      .addCase(purgeWorkflow.fulfilled, (state, action) => {
        state.deleted = state.deleted.filter((w) => w.id !== action.payload);
      })
      .addCase(fetchPausedState.fulfilled, (state, action) => { state.paused = action.payload; })
      .addCase(setPausedAll.fulfilled, (state, action) => { state.paused = action.payload; })
      .addCase(fetchActiveRuns.fulfilled, (state, action) => { state.active = action.payload; })
      .addCase(fetchCloudSmsStatus.fulfilled, (state, action) => { state.cloudSmsEnabled = action.payload; });
  },
});

export const {
  upsertRun,
  openWorkflowCard,
  updateWorkflowCard,
  closeWorkflowCard,
  rekeyOpenCard,
  toggleExpandedStep,
  setCardSidecar,
  clearFixSeed,
  upsertWorkflow,
  removeWorkflow,
  dismissRunningToast,
} = slice.actions;
export default slice.reducer;

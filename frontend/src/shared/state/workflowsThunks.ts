import { createAsyncThunk } from '@reduxjs/toolkit';
import { API_BASE } from '@/shared/config';
import type { ActiveRun, State, Workflow, WorkflowRun, WorkflowRunControlAction } from './workflowsTypes';

const API = `${API_BASE}/workflows`;

export const fetchWorkflows = createAsyncThunk(
  'workflows/fetch',
  async (dashboardId?: string) => {
    const url = dashboardId ? `${API}/list?dashboard_id=${encodeURIComponent(dashboardId)}` : `${API}/list`;
    const res = await fetch(url);
    const data = await res.json();
    return data.workflows as Workflow[];
  },
  { condition: (_, { getState }) => !(getState() as { workflows: State }).workflows.loading },
);

export const createWorkflow = createAsyncThunk(
  'workflows/create',
  async (body: Partial<Workflow> & { metadata_generated?: boolean }) => {
    const res = await fetch(`${API}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`create failed ${res.status}`);
    return (await res.json()) as Workflow;
  },
);

export interface GeneratedMetadata {
  title: string;
  description: string;
  step_labels: string[];
}

export const generateWorkflowMetadata = createAsyncThunk(
  'workflows/generateMetadata',
  async (arg: { steps: Array<{ id: string; text: string }>; model?: string }) => {
    const res = await fetch(`${API}/generate-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arg),
    });
    if (!res.ok) throw new Error(`metadata failed ${res.status}`);
    return (await res.json()) as GeneratedMetadata;
  },
);

// Optimistic concurrency via If-Match: server 409s on stale writes; rejectWithValue lets FE distinguish.
export const updateWorkflow = createAsyncThunk<
  Workflow,
  { id: string; patch: Partial<Workflow>; ifMatch?: string | null },
  { rejectValue: { kind: 'stale' | 'network' | 'server'; message: string; current_updated_at?: string } }
>(
  'workflows/update',
  async ({ id, patch, ifMatch }, { rejectWithValue }) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ifMatch) headers['If-Match'] = ifMatch;
      const res = await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        const detail = (data && (data.detail || data)) || {};
        return rejectWithValue({
          kind: 'stale',
          message: detail.message || 'This workflow changed elsewhere. Reload and try again.',
          current_updated_at: detail.current_updated_at,
        });
      }
      if (!res.ok) {
        return rejectWithValue({ kind: 'server', message: `Update failed (${res.status}).` });
      }
      return (await res.json()) as Workflow;
    } catch (e) {
      return rejectWithValue({ kind: 'network', message: (e as Error)?.message || 'Network error.' });
    }
  },
);

type CommitDraftArg = string | { id: string; model?: string; keep_session?: boolean };

export const commitDraft = createAsyncThunk('workflows/commitDraft', async (arg: CommitDraftArg) => {
  const id = typeof arg === 'string' ? arg : arg.id;
  // Save-gated: the model the user settled on in the Edit Agent picker is applied to the workflow's run model here (Discard never reaches this path).
  const model = typeof arg === 'string' ? undefined : arg.model;
  // keep_session: the build flow auto-commits steps but must keep the chat open.
  const keepSession = typeof arg === 'string' ? undefined : arg.keep_session;
  const body: Record<string, unknown> = {};
  if (model) body.model = model;
  if (keepSession) body.keep_session = true;
  const res = await fetch(`${API}/${id}/draft/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`commit failed ${res.status}`);
  return (await res.json()) as Workflow;
});

export const discardDraft = createAsyncThunk('workflows/discardDraft', async (id: string) => {
  const res = await fetch(`${API}/${id}/draft/discard`, { method: 'POST' });
  if (!res.ok) throw new Error(`discard failed ${res.status}`);
  return (await res.json()) as Workflow;
});

export const deleteWorkflow = createAsyncThunk('workflows/delete', async (id: string) => {
  await fetch(`${API}/${id}`, { method: 'DELETE' });
  return id;
});

export const fetchDeletedWorkflows = createAsyncThunk('workflows/fetchDeleted', async (dashboardId?: string) => {
  const url = dashboardId ? `${API}/deleted?dashboard_id=${encodeURIComponent(dashboardId)}` : `${API}/deleted`;
  const res = await fetch(url);
  const data = await res.json();
  return data.workflows as Workflow[];
});

export const restoreWorkflow = createAsyncThunk('workflows/restore', async (id: string) => {
  const res = await fetch(`${API}/${id}/restore`, { method: 'POST' });
  if (!res.ok) throw new Error(`restore failed ${res.status}`);
  return (await res.json()) as Workflow;
});

export const purgeWorkflow = createAsyncThunk('workflows/purge', async (id: string) => {
  const res = await fetch(`${API}/${id}/purge`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`purge failed ${res.status}`);
  return id;
});

type RunWorkflowNowArg = string | { id: string; signature?: string | null };

export const runWorkflowNow = createAsyncThunk('workflows/run', async (arg: RunWorkflowNowArg) => {
  const id = typeof arg === 'string' ? arg : arg.id;
  const signature = typeof arg === 'string' ? null : arg.signature;
  const res = await fetch(`${API}/${id}/run`, {
    method: 'POST',
    ...(signature ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    } : {}),
  });
  if (!res.ok) throw new Error(`run failed ${res.status}`);
  const data = await res.json();
  return {
    id,
    run_id: (data.run_id || '') as string,
    status: (data.status || null) as string | null,
    error: (data.error || null) as string | null,
  };
});

export const controlWorkflowRun = createAsyncThunk(
  'workflows/controlRun',
  async ({ runId, action }: { runId: string; action: WorkflowRunControlAction }) => {
    const res = await fetch(`${API}/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`${action} failed ${res.status}`);
    const data = await res.json();
    return {
      runId,
      action,
      run: (data.run || null) as WorkflowRun | null,
    };
  },
);

export const fetchRuns = createAsyncThunk(
  'workflows/runs',
  async (id: string) => {
    const res = await fetch(`${API}/${id}/runs?limit=50`);
    const data = await res.json();
    return { id, runs: data.runs as WorkflowRun[] };
  },
);

export const fetchAllRuns = createAsyncThunk(
  'workflows/allRuns',
  async (limit: number = 200) => {
    const res = await fetch(`${API}/runs/all?limit=${limit}`);
    const data = await res.json();
    return data.runs as WorkflowRun[];
  },
);

export const fetchPausedState = createAsyncThunk('workflows/paused', async () => {
  const res = await fetch(`${API}/paused`);
  const data = await res.json();
  return Boolean(data.paused);
});

export const fetchActiveRuns = createAsyncThunk('workflows/active', async () => {
  const res = await fetch(`${API}/active`);
  const data = await res.json();
  return (data.active || []) as ActiveRun[];
});

export const setPausedAll = createAsyncThunk('workflows/setPaused', async (paused: boolean) => {
  const res = await fetch(`${API}/${paused ? 'pause-all' : 'resume-all'}`, { method: 'POST' });
  if (!res.ok) throw new Error(`pause-all toggle failed ${res.status}`);
  const data = await res.json();
  return Boolean(data.paused);
});

export const ackRun = createAsyncThunk('workflows/ackRun', async (runId: string) => {
  const res = await fetch(`${API}/runs/${encodeURIComponent(runId)}/ack`, { method: 'POST' });
  if (!res.ok) throw new Error(`ack failed ${res.status}`);
  return runId;
});

export const fetchCloudSmsStatus = createAsyncThunk('workflows/cloudSms', async () => {
  try {
    const res = await fetch(`${API}/cloud/sms/status`);
    const data = await res.json();
    return Boolean(data.enabled);
  } catch {
    return false;
  }
});

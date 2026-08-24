import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { setCardSidecar } from '@/shared/state/workflowsSlice';
import type { Workflow, WorkflowRun } from '@/shared/state/workflowsSlice';
import StepList, { type StepStatus } from '../StepList';
import { useOpenSidecar, ProgressBar, PillButton } from './WorkflowCardLiveViewsShared';

type ViewMode = 'card' | 'sidecar-linked';

// ---------- RunningView (Image #40) ----------

export function RunningView({ workflow, steps, runs, mode = 'card' }: {
  workflow: Workflow;
  steps: Workflow['steps'];
  runs?: WorkflowRun[];
  mode?: ViewMode;
}) {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const card = useAppSelector((s) => s.workflows.openCards[workflow.id]);
  const runId = card?.runId || null;
  const run = useMemo(() => (runs || []).find((r) => r.id === runId) || null, [runs, runId]);

  // Prefer the backend's real active_step_idx (broadcast on each step bump in executor.execute). Fall back to elapsed/expected heuristic when the field is missing (older runs or first-frame race).
  const heuristicIdx = useActiveStepIdx(steps.length, runs, runId);
  const activeIdx = typeof run?.active_step_idx === 'number' ? run.active_step_idx : heuristicIdx;
  const statuses: StepStatus[] = steps.map((_, i) =>
    i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  );
  const completeCount = statuses.filter((s) => s === 'done').length;
  const total = steps.length;

  // Tool-call subtitle for the active step. Backend polls the session's messages at 1.5s cadence and broadcasts on workflow:run as the agent makes new tool calls. See executor.py _watch_tool_calls.
  const activeSubtitle = run?.last_tool_label || null;
  const activeDuration = formatLiveDuration(run);

  const isLinked = mode === 'sidecar-linked' && (card?.sidecarKind === 'watching' || card?.sidecarKind === 'testing');

  const openSidecar = useOpenSidecar(workflow.id);
  const onWatchLive = useCallback(() => {
    if (run?.session_id) void openSidecar(run.session_id, 'watching');
  }, [openSidecar, run?.session_id]);
  const onStopWatching = useCallback(() => {
    dispatch(setCardSidecar({ workflowId: workflow.id, sessionId: null, kind: null }));
  }, [dispatch, workflow.id]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: '0.92rem', fontWeight: 700, color: c.status.success }}>
          {t('workflows.liveViews.completeOf', { done: completeCount, total })}
        </Typography>
      </Box>
      <ProgressBar value={total > 0 ? completeCount / total : 0} color={c.status.success} />
      <StepList
        workflow={workflow}
        steps={steps}
        stepStatuses={statuses}
        activeStepSubtitle={activeSubtitle}
        activeStepDuration={activeDuration}
      />
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {isLinked ? (
          <PillButton
            label={t('workflows.liveViews.stopWatching')}
            tone="danger"
            filled={false}
            icon={<VisibilityOffOutlined sx={{ fontSize: 16 }} />}
            onClick={onStopWatching}
          />
        ) : (
          <PillButton
            label={t('workflows.liveViews.watchLive')}
            tone="muted"
            filled={false}
            icon={<VisibilityOutlined sx={{ fontSize: 16 }} />}
            onClick={onWatchLive}
          />
        )}
      </Box>
      {/* Stop / Pause live in the header row, rendered by WorkflowCard. */}
    </Box>
  );
}

function useActiveStepIdx(stepCount: number, runs: WorkflowRun[] | undefined, activeRunId: string | null | undefined): number {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!activeRunId) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % 1000000), 1000);
    return () => window.clearInterval(id);
  }, [activeRunId]);
  if (!activeRunId || !runs) return 0;
  const active = runs.find((r) => r.id === activeRunId && r.status === 'running');
  if (!active) return 0;
  const elapsed = Date.now() - new Date(active.started_at).getTime();
  const completed = runs.filter((r) => (r.status === 'success' || r.status === 'ran_late') && r.finished_at);
  if (completed.length === 0) {
    return Math.min(stepCount - 1, Math.max(0, Math.floor(stepCount / 2)));
  }
  const durations = completed.slice(0, 10).map((r) => new Date(r.finished_at!).getTime() - new Date(r.started_at).getTime());
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length || 1;
  const ratio = Math.min(0.99, Math.max(0, elapsed / avg));
  return Math.min(stepCount - 1, Math.floor(ratio * stepCount));
}

function formatLiveDuration(run: WorkflowRun | null): string | null {
  if (!run || run.status !== 'running') return null;
  try {
    const ms = Date.now() - new Date(run.started_at).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    return `${m}m`;
  } catch { return null; }
}

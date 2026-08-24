import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import BuildRounded from '@mui/icons-material/BuildRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { updateWorkflowCard } from '@/shared/state/workflowsSlice';
import type { Workflow, WorkflowRun } from '@/shared/state/workflowsSlice';
import StepList, { type StepStatus } from '../StepList';
import { useOpenSidecar, stopViewingSidecar, PillButton, GhostTextBtn } from './WorkflowCardLiveViewsShared';

type ViewMode = 'card' | 'sidecar-linked';

// ---------- FailedView (Image #46) ----------

export function FailedView({ workflow, steps, runs, mode = 'card' }: {
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
  const failedIdx = guessFailedIdx(run, steps.length);
  const statuses: StepStatus[] = steps.map((_, i) =>
    i < failedIdx ? 'done' : i === failedIdx ? 'failed' : 'pending',
  );
  // Same as CompletedView: a watched run that fails stays tethered, so treat the still-'watching' kind as linked and show Stop Viewing instead of View Error (which would open a second chat).
  const isLinked = mode === 'sidecar-linked' && (card?.sidecarKind === 'viewing-error' || card?.sidecarKind === 'watching');

  const onIgnore = useCallback(() => {
    dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'saved', runId: null, sidecarSessionId: null, sidecarKind: null } }));
  }, [dispatch, workflow.id]);
  const openSidecar = useOpenSidecar(workflow.id);
  const onViewError = useCallback(() => {
    if (run?.session_id) void openSidecar(run.session_id, 'viewing-error');
  }, [openSidecar, run?.session_id]);
  const onStopViewing = useCallback(() => {
    stopViewingSidecar(dispatch, workflow.id, card?.sidecarSessionId);
  }, [dispatch, workflow.id, card?.sidecarSessionId]);
  const onFixWithAgent = useCallback(() => {
    if (!run) return;
    const stepLabel = steps[failedIdx]?.label || steps[failedIdx]?.text?.slice(0, 60) || t('workflows.liveViews.stepNumber', { number: failedIdx + 1 });
    dispatch(updateWorkflowCard({
      workflowId: workflow.id,
      patch: {
        view: 'fix_agent',
        sidecarSessionId: null,
        sidecarKind: null,
        fixSeed: { runId: run.id, stepIdx: failedIdx, stepLabel, error: run.error || t('workflows.liveViews.stepFailed') },
      },
    }));
  }, [dispatch, workflow.id, run, steps, failedIdx, t]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: '100%' }}>
      <StepList
        workflow={workflow}
        steps={steps}
        stepStatuses={statuses}
      />
      <Box sx={{ flex: 1 }} />
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1.25,
        p: 1.5, borderRadius: `${c.radius.lg}px`,
        bgcolor: c.status.errorBg,
        border: `1px solid ${c.status.error}30`,
      }}>
        <Box sx={{
          width: 32, height: 32, borderRadius: `${c.radius.md}px`,
          bgcolor: c.status.error + '22', color: c.status.error,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <BuildRounded sx={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: c.text.primary, lineHeight: 1.3 }}>
            {t('workflows.liveViews.fixTitle')}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: c.text.secondary, mt: 0.25, lineHeight: 1.45 }}>
            {t('workflows.liveViews.fixBody')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        {isLinked ? (
          <PillButton
            label={t('workflows.liveViews.stopViewing')}
            tone="danger"
            filled={false}
            icon={<VisibilityOffOutlined sx={{ fontSize: 16 }} />}
            onClick={onStopViewing}
          />
        ) : (
          <PillButton
            label={t('workflows.liveViews.viewError')}
            tone="muted"
            filled={false}
            icon={<VisibilityOutlined sx={{ fontSize: 16 }} />}
            onClick={onViewError}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <GhostTextBtn label={t('workflows.liveViews.ignore')} onClick={onIgnore} />
        <PillButton
          label={t('workflows.liveViews.fixWithAgent')}
          tone="danger"
          filled
          onClick={onFixWithAgent}
        />
      </Box>
    </Box>
  );
}

function guessFailedIdx(run: WorkflowRun | null, total: number): number {
  if (!run) return Math.max(0, total - 1);
  // Backend pins active_step_idx at the failed step before flipping status to 'failure'. Prefer that; fall back to parsing "Step N" out of the error string for legacy runs.
  if (typeof run.active_step_idx === 'number') {
    return Math.max(0, Math.min(total - 1, run.active_step_idx));
  }
  if (run.error) {
    const m = /step\s+(\d+)/i.exec(run.error);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n >= 1 && n <= total) return n - 1;
    }
  }
  return Math.max(0, Math.min(total - 1, 1));
}

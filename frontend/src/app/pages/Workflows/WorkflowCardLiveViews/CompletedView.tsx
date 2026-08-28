import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { updateWorkflowCard } from '@/shared/state/workflowsSlice';
import type { Workflow, WorkflowRun } from '@/shared/state/workflowsSlice';
import StepList, { type StepStatus } from '../StepList';
import { useOpenSidecar, stopViewingSidecar, ProgressBar, PillButton, GhostTextBtn } from './WorkflowCardLiveViewsShared';

type ViewMode = 'card' | 'sidecar-linked';

// ---------- CompletedView (Image #42) ----------

export function CompletedView({ workflow, steps, runs, mode = 'card' }: {
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
  const statuses: StepStatus[] = steps.map(() => 'done');
  // A run that was being watched live stays tethered to the same chat when it finishes, so the still-'watching' kind counts as linked too (the slice's watching->viewing-completed flip can miss on fast runs). Without this the card offers "View Agent", which spawns a duplicate chat.
  const isLinked = mode === 'sidecar-linked' && (card?.sidecarKind === 'viewing-completed' || card?.sidecarKind === 'watching');

  const onDone = useCallback(() => {
    dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'saved', runId: null, sidecarSessionId: null, sidecarKind: null } }));
  }, [dispatch, workflow.id]);
  const onEdit = useCallback(() => {
    dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'edit_agent' } }));
  }, [dispatch, workflow.id]);
  const openSidecar = useOpenSidecar(workflow.id);
  const onViewAgent = useCallback(() => {
    if (run?.session_id) void openSidecar(run.session_id, 'viewing-completed');
  }, [openSidecar, run?.session_id]);
  const onStopViewing = useCallback(() => {
    stopViewingSidecar(dispatch, workflow.id, card?.sidecarSessionId);
  }, [dispatch, workflow.id, card?.sidecarSessionId]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
        <Box component="span" sx={{ color: c.status.success, fontSize: 18, lineHeight: 1, mr: 0.25 }}>✓</Box>
        <Typography sx={{ fontSize: '0.92rem', fontWeight: 700, color: c.status.success }}>
          {t('workflows.liveViews.completeOf', { done: steps.length, total: steps.length })}
        </Typography>
      </Box>
      <ProgressBar value={1} color={c.status.success} />
      <StepList
        workflow={workflow}
        steps={steps}
        stepStatuses={statuses}
      />
      <Box sx={{ flex: 1 }} />
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1.25,
        p: 1.5, borderRadius: `${c.radius.lg}px`,
        bgcolor: c.status.successBg,
        border: `1px solid ${c.status.success}30`,
      }}>
        <Box sx={{
          width: 32, height: 32, borderRadius: `${c.radius.md}px`,
          bgcolor: c.status.success + '22', color: c.status.success,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <RocketLaunchRounded sx={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: c.text.primary, lineHeight: 1.3 }}>
            {t('workflows.liveViews.successTitle')}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: c.text.secondary, mt: 0.25, lineHeight: 1.45 }}>
            {t('workflows.liveViews.successBody')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <PillButton
          label={t('common.edit')}
          tone="muted"
          filled={false}
          icon={<EditOutlined sx={{ fontSize: 15 }} />}
          onClick={onEdit}
        />
        <Box sx={{ flex: 1 }} />
        {/* Image #43: Done is hidden in sidecar mode; Stop Viewing alone
            fills the right slot. Default mode keeps Done + View Agent. */}
        {!isLinked && <GhostTextBtn label={t('workflows.liveViews.done')} onClick={onDone} />}
        {isLinked ? (
          <PillButton
            label={t('workflows.liveViews.stopViewing')}
            tone="success"
            filled={false}
            icon={<VisibilityOffOutlined sx={{ fontSize: 16 }} />}
            onClick={onStopViewing}
          />
        ) : (
          <PillButton
            label={t('workflows.liveViews.viewAgent')}
            tone="success"
            filled
            onClick={onViewAgent}
          />
        )}
      </Box>
    </Box>
  );
}

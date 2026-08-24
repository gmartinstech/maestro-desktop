import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  closeWorkflowCard,
  toggleExpandedStep,
  updateWorkflow,
  updateWorkflowCard,
  type Workflow,
  type WorkflowRun,
} from '@/shared/state/workflowsSlice';
import { placeCard, removeWorkflowCard } from '@/shared/state/dashboardLayoutSlice';
import { setPendingFocusAgentId } from '@/shared/state/tempStateSlice';
import { describeSchedule, isScheduleConfigured, needsScheduleTestWarning, stepsSignature } from '@/app/pages/Workflows/schedule/scheduleUtils';
import ScheduleTestWarningDialog from '@/app/pages/Workflows/schedule/ScheduleTestWarningDialog';
import StepList from '../StepList';
import { runWorkflowTest } from '@/app/pages/Workflows/schedule/runWorkflowTest';
import { useOpenSidecar } from '../WorkflowCardLiveViews';
import { StreakBadge } from '../workflowVisuals';

export function SavedView({ workflow, steps, runs, activeRunId }: { workflow: Workflow; steps: Workflow['steps']; runs?: WorkflowRun[]; activeRunId?: string | null }) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  void runs; void activeRunId;
  const card = useAppSelector((s) => s.workflows.openCards[workflow.id]);
  const expandedIds = card?.expandedStepIds || [];
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null);
  const openEditAgent = useCallback(() => {
    dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'edit_agent' } }));
  }, [dispatch, workflow.id]);
  const openSidecar = useOpenSidecar(workflow.id);
  const [warnOpen, setWarnOpen] = useState(false);
  const openScheduling = useCallback(() => {
    dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'scheduling', showScheduleNudge: false } }));
  }, [dispatch, workflow.id]);
  // Gate the schedule action: warn first if the current steps haven't been validated by a test run (so an unattended fire won't silently deny a tool).
  const requestSchedule = useCallback(() => {
    if (needsScheduleTestWarning(workflow)) { setWarnOpen(true); return; }
    openScheduling();
  }, [workflow, openScheduling]);
  const onTestFirst = useCallback(() => {
    setWarnOpen(false);
    void runWorkflowTest(workflow.id, workflow.draft_steps ?? workflow.steps, openSidecar);
  }, [workflow.id, workflow.draft_steps, workflow.steps, openSidecar]);
  const onScheduleAnyway = useCallback(() => {
    setWarnOpen(false);
    openScheduling();
  }, [openScheduling]);
  const onToggleStep = useCallback((stepId: string) => {
    dispatch(toggleExpandedStep({ workflowId: workflow.id, stepId }));
  }, [dispatch, workflow.id]);
  const onDeleteStep = useCallback(async (idx: number, stepId: string) => {
    if (workflow.steps.length <= 1 || deletingStepId) return;
    setDeletingStepId(stepId);
    try {
      await dispatch(updateWorkflow({
        id: workflow.id,
        patch: { steps: workflow.steps.filter((_, i) => i !== idx) },
        ifMatch: workflow.updated_at || null,
      }));
    } finally {
      setDeletingStepId(null);
    }
  }, [deletingStepId, dispatch, workflow.id, workflow.steps, workflow.updated_at]);

  // "Not now" on the post-convert nudge doesn't dump you on a near-identical saved card: the workflow is already saved (find it in the hub), so we drop its card and reopen the chat it came from, right in the same slot.
  const wfCardPos = useAppSelector((s) => s.dashboardLayout.workflowCards[workflow.id]);
  const expandedSessionIds = useAppSelector((s) => s.agents.expandedSessionIds);
  const sourceId = workflow.source_session_id || null;
  const sourceExists = useAppSelector((s) => (sourceId ? !!s.agents.sessions[sourceId] : false));
  const onNotNow = useCallback(() => {
    if (sourceId && sourceExists && wfCardPos) {
      const { x, y, width, height } = wfCardPos;
      dispatch(removeWorkflowCard(workflow.id));
      dispatch(closeWorkflowCard(workflow.id));
      dispatch(placeCard({ sessionId: sourceId, x, y, width, height, expandedSessionIds }));
      dispatch(setPendingFocusAgentId(sourceId));
    } else {
      // No chat to fall back to (rare): just retire the prompt in place.
      dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { showScheduleNudge: false } }));
    }
  }, [dispatch, sourceId, sourceExists, wfCardPos, expandedSessionIds, workflow.id]);

  const scheduleConfigured = isScheduleConfigured(workflow.schedule);
  const scheduleLine = workflow.schedule.enabled && scheduleConfigured
    ? describeSchedule(workflow.schedule, t, i18n.language)
    : t('workflows.subviews.scheduleThisWorkflow');
  const scheduleClickable = !scheduleConfigured;
  // One-shot prompt right after a convert; hub-opened cards never set the flag, so they fall straight to the quiet schedule line below.
  const showNudge = !!card?.showScheduleNudge && !scheduleConfigured;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: '100%' }}>
      <StepList
        workflow={workflow}
        steps={steps}
        expandable
        expandedIds={expandedIds}
        onToggleExpand={onToggleStep}
        onDeleteStep={onDeleteStep}
      />
      <Box sx={{ flex: 1 }} />
      {showNudge && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1.25,
          p: 1.5, borderRadius: `${c.radius.lg}px`,
          bgcolor: c.accent.primary + '10',
          border: `1px solid ${c.accent.primary}30`,
        }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: `${c.radius.md}px`,
            bgcolor: c.accent.primary + '22', color: c.accent.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <CalendarMonthRounded sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: c.text.primary, lineHeight: 1.3 }}>
              {t('workflows.subviews.scheduleNudgeTitle')}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', color: c.text.secondary, mt: 0.25, lineHeight: 1.45 }}>
              {t('workflows.subviews.scheduleNudgeBody')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, mt: 1.25 }}>
              <Box
                onClick={onNotNow}
                role="button"
                sx={{
                  fontSize: '0.86rem', fontWeight: 500, color: c.text.secondary,
                  cursor: 'pointer', px: 0.75, py: 0.5,
                  '&:hover': { color: c.text.primary },
                }}>
                {t('workflows.subviews.notNow')}
              </Box>
              <Box
                onClick={requestSchedule}
                role="button"
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  fontSize: '0.88rem', fontWeight: 700,
                  px: 1.75, py: 0.6, borderRadius: c.radius.full,
                  color: '#fff', bgcolor: c.accent.primary,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: c.accent.primary, filter: 'brightness(1.06)' },
                }}>
                {t('workflows.subviews.scheduleWorkflow')}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {showNudge ? <Box /> : (
        <Box
          onClick={scheduleClickable ? requestSchedule : undefined}
          role={scheduleClickable ? 'button' : undefined}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.6,
            color: c.text.secondary, fontSize: '0.86rem', minWidth: 0,
            cursor: scheduleClickable ? 'pointer' : 'default',
            '&:hover': scheduleClickable ? { color: c.text.primary } : {},
          }}>
          <CalendarMonthRounded sx={{ fontSize: 16, color: c.text.muted, flexShrink: 0 }} />
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scheduleLine}</Box>
        </Box>
        )}
        <Box
          onClick={openEditAgent}
          role="button"
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.45,
            fontSize: '0.82rem', fontWeight: 600,
            px: 1.25, py: 0.5,
            borderRadius: c.radius.full,
            cursor: 'pointer',
            color: c.text.secondary,
            bgcolor: 'transparent',
            border: `1px solid ${c.border.medium}`,
            '&:hover': { bgcolor: c.bg.elevated, borderColor: c.border.strong, color: c.text.primary },
          }}>
          <EditOutlined sx={{ fontSize: 15 }} />
          {t('common.edit')}
        </Box>
      </Box>
      <ScheduleTestWarningDialog
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        onTestFirst={onTestFirst}
        onScheduleAnyway={onScheduleAnyway}
      />
    </Box>
  );
}

// kept on file for legacy uses; once the audit popover migrates, this and the StreakBadge / habit-suggestion blocks above can be deleted entirely.
void StreakBadgeRow;

// Splits StreakBadge out so the SavedView body doesn't have to ferry the runs array through both the chip row (gone) and the step list.
function StreakBadgeRow({ runs }: { runs?: WorkflowRun[] }) {
  if (!runs || runs.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <StreakBadge runs={runs} />
    </Box>
  );
}

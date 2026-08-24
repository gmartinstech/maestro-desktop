import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  createWorkflow,
  toggleExpandedStep,
  updateWorkflowCard,
  type Workflow,
} from '@/shared/state/workflowsSlice';
import { stepsSignature } from '@/app/pages/Workflows/schedule/scheduleUtils';
import StepList from '../StepList';

export function PreviewView({ workflowId, steps, sourceSessionId, initialDraft, onSaved, onDiscardDraft, closeRequestNonce }: {
  workflowId: string;
  steps: Workflow['steps'];
  sourceSessionId: string | null;
  initialDraft: Partial<Workflow> | null;
  onSaved: (w: Workflow, options?: { view?: 'saved' | 'scheduling'; close?: boolean }) => void;
  onDiscardDraft?: () => void;
  closeRequestNonce?: number;
}) {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  // Title + description live in the openCard draft so the parent header (which renders the inline-editable title) and PreviewView body (which renders the inline-editable description + steps) stay in sync. On Save we pull whatever's currently in the draft, falling back to the initialDraft passed at mount time.
  const card = useAppSelector((s) => s.workflows.openCards[workflowId]);
  const liveDraft = (card?.draft ?? initialDraft ?? {}) as Partial<Workflow>;
  const title = (liveDraft.title as string) || t('workflows.subviews.newWorkflow');
  const description = (liveDraft.description as string) || '';
  const canSave = steps.some((s) => (s.text || '').trim().length > 0);
  // The new workflow runs with the user's configured default model/mode (their subscription, etc.), falling back to whatever the source chat used. Without this the backend picks its own default, which surprised users who'd set a subscription default but saw the workflow created on an API-key model.
  const defaultModel = useAppSelector((s) => s.settings.data.default_model);
  const defaultMode = useAppSelector((s) => s.settings.data.default_mode);
  // Steps render compact (label + chevron, capped + "... N more"), same as the saved card. The raw prompt drills down on click. Keeping them short is what leaves room for the schedule prompt + buttons to stay on-card.
  const expandedIds = card?.expandedStepIds || [];
  const onToggleStep = useCallback((stepId: string) => {
    dispatch(toggleExpandedStep({ workflowId, stepId }));
  }, [dispatch, workflowId]);

  const onDeleteStep = useCallback((idx: number, stepId: string) => {
    if (steps.length <= 1) return;
    const nextSteps = steps.filter((_, i) => i !== idx);
    dispatch(updateWorkflowCard({
      workflowId,
      patch: {
        draft: {
          ...liveDraft,
          steps: nextSteps,
        },
        expandedStepIds: (card?.expandedStepIds || []).filter((id) => id !== stepId),
      },
    }));
  }, [card?.expandedStepIds, dispatch, liveDraft, steps, workflowId]);

  const onChangeDescription = useCallback((value: string) => {
    dispatch(updateWorkflowCard({ workflowId, patch: { draft: { ...liveDraft, description: value } } }));
  }, [dispatch, workflowId, liveDraft]);

  useEffect(() => {
    if (closeRequestNonce) setSavePromptOpen(true);
  }, [closeRequestNonce]);

  const saveWorkflow = useCallback(async (): Promise<Workflow | null> => {
    if (!canSave) return null;
    const result = await dispatch(createWorkflow({
      title,
      description,
      steps: steps.map((s) => ({ id: s.id, text: s.text, label: s.label })),
      metadata_generated: card?.metaGenerated === true,
      source_session_id: sourceSessionId,
      use_synced_prompt: true,
      // The user's configured default wins over whatever model the source chat happened to run on, so a converted workflow behaves like a fresh chat.
      model: defaultModel || (liveDraft.model as string),
      mode: defaultMode || (liveDraft.mode as string),
      // Converting a chat carries its prior approvals, so count it as already validated for these steps: scheduling won't nag to test first.
      tested_signature: sourceSessionId ? stepsSignature(steps) : undefined,
    } as Partial<Workflow>));
    if (!createWorkflow.fulfilled.match(result)) return null;
    const wf = result.payload as Workflow;
    if (wf?.id) return wf;
    return null;
  }, [canSave, dispatch, title, description, steps, sourceSessionId, liveDraft, defaultModel, defaultMode, card]);

  const onIgnore = useCallback(async () => {
    if (busy) return;
    setSavePromptOpen(true);
  }, [busy]);

  const onSaveThenSchedule = useCallback(async () => {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const wf = await saveWorkflow();
      if (wf?.id) onSaved(wf, { view: 'scheduling' });
    } finally {
      setBusy(false);
    }
  }, [busy, canSave, saveWorkflow, onSaved]);

  const onSaveDraft = useCallback(async () => {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const wf = await saveWorkflow();
      if (wf?.id) onSaved(wf, { view: 'saved', close: true });
    } finally {
      setBusy(false);
      setSavePromptOpen(false);
    }
  }, [busy, canSave, saveWorkflow, onSaved]);

  const onDontSave = useCallback(() => {
    setSavePromptOpen(false);
    onDiscardDraft?.();
  }, [onDiscardDraft]);

  void onChangeDescription;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: '100%' }}>
      <StepList steps={steps} expandable expandedIds={expandedIds} onToggleExpand={onToggleStep} onDeleteStep={onDeleteStep} />
      <Box sx={{ flex: 1 }} />
      {/* Schedule prompt card. Soft accent tint + calendar icon. Accent is the
          same color the human-intervention (AskUserQuestion) popup uses. */}
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
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5 }}>
        <Box
          onClick={onIgnore}
          role="button"
          sx={{
            fontSize: '0.86rem', fontWeight: 500, color: c.text.secondary,
            cursor: busy ? 'wait' : 'pointer', px: 0.75, py: 0.5,
            opacity: busy ? 0.6 : 1,
            '&:hover': { color: c.text.primary },
          }}>
          {t('workflows.subviews.notNow')}
        </Box>
        <Box
          onClick={canSave ? onSaveThenSchedule : undefined}
          role="button"
          title={canSave ? undefined : t('workflows.subviews.needStepTooltip')}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5,
            fontSize: '0.88rem', fontWeight: 700,
            px: 1.75, py: 0.6, borderRadius: c.radius.full,
            color: '#fff', bgcolor: c.accent.primary,
            cursor: busy ? 'wait' : canSave ? 'pointer' : 'not-allowed',
            opacity: busy || !canSave ? 0.6 : 1,
            '&:hover': { bgcolor: c.accent.primary, filter: 'brightness(1.06)' },
          }}>
          {t('workflows.subviews.scheduleWorkflow')}
        </Box>
      </Box>
      <Dialog open={savePromptOpen} onClose={() => setSavePromptOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>{t('workflows.subviews.savePromptTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.86rem', color: c.text.secondary }}>
            {t('workflows.subviews.savePromptBody')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Box
            role="button"
            onClick={onDontSave}
            sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.status.error, cursor: busy ? 'wait' : 'pointer', px: 1, py: 0.5, opacity: busy ? 0.6 : 1 }}>
            {t('workflows.subviews.dontSave')}
          </Box>
          <Box
            role="button"
            onClick={() => setSavePromptOpen(false)}
            sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.text.secondary, cursor: busy ? 'wait' : 'pointer', px: 1, py: 0.5, opacity: busy ? 0.6 : 1 }}>
            {t('common.cancel')}
          </Box>
          <Box
            role="button"
            onClick={canSave ? onSaveDraft : undefined}
            title={canSave ? undefined : t('workflows.subviews.needStepTooltip')}
            sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff', bgcolor: c.accent.primary, borderRadius: c.radius.full, cursor: busy ? 'wait' : canSave ? 'pointer' : 'not-allowed', px: 1.5, py: 0.6, opacity: busy || !canSave ? 0.6 : 1, '&:hover': { filter: 'brightness(1.06)' } }}>
            {t('common.save')}
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

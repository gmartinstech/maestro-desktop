import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import HistoryIcon from '@mui/icons-material/HistoryRounded';
import PlayArrowIcon from '@mui/icons-material/PlayArrowRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch } from '@/shared/hooks';
import { updateWorkflowCard, type Workflow } from '@/shared/state/workflowsSlice';

// ---------- Header overrides ---------- The card header normally renders {History | Run}. Running shows {Stop | Pause}, Completed/Failed keep {History | Run}, Edit/Fix shows {Discard | Save}, Scheduling shows {Cancel task scheduling}. The WorkflowCard hands off via this helper so each view can declare its own header without the parent fanning out a switch.

export interface HeaderActions {
  left?: React.ReactNode;
  right: React.ReactNode;
}

export function useHeaderActions(workflow: Workflow | null, view: string): HeaderActions {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  return useMemo<HeaderActions>(() => {
    if (!workflow) return { right: null };
    const HistoryRun = (
      <>
        <Box
          onClick={() => dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'history' } }))}
          role="button"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, fontSize: '0.82rem', fontWeight: 600, px: 1, py: 0.4, color: c.text.secondary, cursor: 'pointer', '&:hover': { color: c.text.primary } }}>
          <HistoryIcon sx={{ fontSize: 15 }} />
          {t('workflows.liveViews.history')}
        </Box>
        <Box
          onClick={() => dispatch(updateWorkflowCard({ workflowId: workflow.id, patch: { view: 'saved' } }))}
          role="button"
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.35,
            fontSize: '0.82rem', fontWeight: 700,
            px: 1.1, py: 0.4, borderRadius: 999,
            bgcolor: c.accent.primary, color: '#fff', cursor: 'pointer',
            '&:hover': { filter: 'brightness(1.05)' },
          }}>
          <PlayArrowIcon sx={{ fontSize: 15 }} />
          {t('workflows.liveViews.run')}
        </Box>
      </>
    );
    if (view === 'running') {
      return {
        right: (
          <>
            <Box role="button" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, fontSize: '0.82rem', fontWeight: 600, px: 1, py: 0.4, color: c.text.secondary, cursor: 'pointer', '&:hover': { color: c.text.primary } }}>
              <StopRounded sx={{ fontSize: 15 }} />
              {t('workflows.liveViews.stop')}
            </Box>
            <Box role="button" sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.35,
              fontSize: '0.82rem', fontWeight: 700,
              px: 1.1, py: 0.4, borderRadius: 999,
              bgcolor: c.accent.primary, color: '#fff', cursor: 'pointer',
              '&:hover': { filter: 'brightness(1.05)' },
            }}>
              <PauseRounded sx={{ fontSize: 15 }} />
              {t('workflows.liveViews.pause')}
            </Box>
          </>
        ),
      };
    }
    return { right: HistoryRun };
  }, [workflow, view, dispatch, c, t]);
}

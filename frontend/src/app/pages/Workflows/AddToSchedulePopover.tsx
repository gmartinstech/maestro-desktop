import React, { useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch } from '@/shared/hooks';
import { addWorkflowCard } from '@/shared/state/dashboardLayoutSlice';
import { openWorkflowCard, updateWorkflow, type Workflow } from '@/shared/state/workflowsSlice';
import { describeSchedule } from './scheduleUtils';

interface Props {
  anchorEl: HTMLElement | null;
  workflow: Workflow | null;
  onClose: () => void;
}

// Opens off an Un-scheduled workflow's "+" icon. Two paths: keep the cadence
// the workflow already carries (just flip enabled on) or open the scheduler
// to change it. Enabling moves the row into "Scheduled workflows" since
// isSchedulable keys off schedule.enabled.
export default function AddToSchedulePopover({ anchorEl, workflow, onClose }: Props) {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();

  // describeSchedule returns "Not scheduled" while disabled; preview the
  // cadence as if it were on so "Keep" shows what it would commit to.
  const summary = workflow ? describeSchedule({ ...workflow.schedule, enabled: true }) : '';

  const keep = useCallback(() => {
    if (!workflow) return;
    dispatch(updateWorkflow({
      id: workflow.id,
      patch: { schedule: { ...workflow.schedule, enabled: true } as any },
      ifMatch: workflow.updated_at || null,
    }));
    onClose();
  }, [dispatch, workflow, onClose]);

  const change = useCallback(() => {
    if (!workflow) return;
    dispatch(addWorkflowCard({ workflowId: workflow.id }));
    dispatch(openWorkflowCard({ workflowId: workflow.id, view: 'scheduling' }));
    onClose();
  }, [dispatch, workflow, onClose]);

  const rowSx = {
    display: 'flex', alignItems: 'center', gap: 0.9,
    px: 0.75, py: 0.65, borderRadius: `${c.radius.md}px`, cursor: 'pointer',
    '&:hover': { bgcolor: c.bg.elevated },
  };
  const iconSx = {
    width: 28, height: 28, borderRadius: `${c.radius.md}px`, flexShrink: 0,
    bgcolor: c.accent.primary + '18', color: c.accent.primary,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <Popover
      open={Boolean(anchorEl && workflow)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
      transformOrigin={{ vertical: 'center', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 272, p: 1, ml: 0.75 } } }}
    >
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', px: 0.75, mb: 0.5 }}>
        ADD TO SCHEDULE
      </Typography>
      <Box role="button" onClick={keep} sx={rowSx}>
        <Box sx={iconSx}><CalendarMonthRounded sx={{ fontSize: 16 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.text.primary }}>Keep this schedule</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</Typography>
        </Box>
      </Box>
      <Box role="button" onClick={change} sx={rowSx}>
        <Box sx={iconSx}><TuneRoundedIcon sx={{ fontSize: 16 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.text.primary }}>Change schedule…</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted }}>Pick a different time</Typography>
        </Box>
      </Box>
    </Popover>
  );
}

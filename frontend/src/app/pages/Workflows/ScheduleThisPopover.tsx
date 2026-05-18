// Minimum-steps-to-value entry point: from any open chat, hit "Schedule"
// in the header, pick one of four presets, and we materialize a workflow
// seeded with source_session_id (so it inherits the chat's tool surface
// + steps via the existing /workflows/create path). "Custom..." opens
// the full editor for power users.

import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import InputBase from '@mui/material/InputBase';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch } from '@/shared/hooks';
import { createWorkflow, openWorkflowCard, type ScheduleConfig } from '@/shared/state/workflowsSlice';
import { defaultSchedule } from './scheduleUtils';

type Preset = {
  label: string;
  hint: string;
  build: () => Partial<ScheduleConfig>;
};

const PRESETS: Preset[] = [
  { label: 'Every day at 9am', hint: 'Daily standup, morning report', build: () => ({ enabled: true, repeat_unit: 'day', repeat_every: 1, hour: 9, minute: 0 }) },
  { label: 'Weekdays at 9am', hint: 'Mon to Fri', build: () => ({ enabled: true, repeat_unit: 'week', repeat_every: 1, on_days: [1, 2, 3, 4, 5], hour: 9, minute: 0 }) },
  { label: 'Every Monday at 9am', hint: 'Weekly check-in', build: () => ({ enabled: true, repeat_unit: 'week', repeat_every: 1, on_days: [1], hour: 9, minute: 0 }) },
  { label: 'Every month on the 1st', hint: 'Monthly summary, billing report', build: () => ({ enabled: true, repeat_unit: 'month', repeat_every: 1, hour: 9, minute: 0 }) },
];

interface Props {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
  // Hook so the caller can show "Workflow created" feedback inline.
  onCreated?: (workflowId: string) => void;
}

export default function ScheduleThisPopover({ anchorEl, onClose, sessionId, sessionName, onCreated }: Props) {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState<string>(sessionName || 'Untitled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (preset: Preset) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const schedule: ScheduleConfig = { ...defaultSchedule(), ...preset.build() };
      const result = await dispatch(createWorkflow({
        title,
        source_session_id: sessionId,
        schedule,
      } as any));
      if (createWorkflow.fulfilled.match(result)) {
        const wf: any = result.payload;
        dispatch(openWorkflowCard({ workflowId: wf.id, view: 'saved' }));
        onCreated?.(wf.id);
        onClose();
      } else {
        setError('Create failed. Try again.');
      }
    } catch (e) {
      setError((e as Error)?.message || 'Create failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, dispatch, sessionId, title, onClose, onCreated]);

  const openCustom = useCallback(async () => {
    // "Custom..." materializes a workflow with schedule.enabled=false
    // and routes to the full editor. The editor's master toggle is the
    // explicit gate — nothing fires until the user flips it on.
    if (busy) return;
    setBusy(true);
    try {
      const schedule: ScheduleConfig = { ...defaultSchedule() };
      const result = await dispatch(createWorkflow({
        title,
        source_session_id: sessionId,
        schedule,
      } as any));
      if (createWorkflow.fulfilled.match(result)) {
        const wf: any = result.payload;
        dispatch(openWorkflowCard({ workflowId: wf.id, view: 'edit', editFacet: 'Schedule' }));
        onCreated?.(wf.id);
        onClose();
      } else {
        setError('Create failed. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, dispatch, sessionId, title, onClose, onCreated]);

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { width: 320, p: 1.25 } } }}
    >
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', mb: 0.75 }}>
        SCHEDULE THIS CHAT
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.78rem', color: c.text.secondary }}>Name:</Typography>
        <InputBase
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ flex: 1, fontSize: '0.85rem', color: c.text.primary, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.3 }}
        />
      </Box>
      {PRESETS.map((p) => (
        <Box
          key={p.label}
          role="button"
          onClick={() => submit(p)}
          sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            px: 1, py: 0.6, borderRadius: `${c.radius.md}px`,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.5 : 1,
            '&:hover': { bgcolor: c.bg.elevated },
          }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: c.text.primary }}>{p.label}</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted }}>{p.hint}</Typography>
        </Box>
      ))}
      <Box
        role="button"
        onClick={openCustom}
        sx={{
          mt: 0.5, borderTop: `1px solid ${c.border.subtle}`,
          px: 1, py: 0.7, borderRadius: `${c.radius.md}px`,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.5 : 1,
          '&:hover': { bgcolor: c.bg.elevated },
        }}>
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.accent.primary }}>Custom…</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: c.text.muted }}>Open the full editor</Typography>
      </Box>
      {error && (
        <Typography sx={{ mt: 0.5, fontSize: '0.74rem', color: c.status.error }}>{error}</Typography>
      )}
    </Popover>
  );
}

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { formatClock } from '@/app/pages/Workflows/schedule/scheduleUtils';
import { labelForStatus } from '@/app/pages/Workflows/WorkflowCardSubviews';

// Apple Calendar style event stack: tiny bars in the hour cell, followed by a text overflow affordance when the hour has more runs than fit.
export function EventStack({ events, paused, now, maxVisible, onSelectWorkflow, eventFontSize, onContextWorkflow }: {
  events: { workflow: Workflow; date: Date }[];
  paused?: boolean;
  now: Date;
  maxVisible: number;
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
  eventFontSize: string;
  onContextWorkflow?: (workflow: Workflow, e: React.MouseEvent) => void;
}) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (events.length === 0) return null;
  const visible = events.slice(0, maxVisible);
  const rest = events.slice(maxVisible);
  const accent = c.accent.primary;

  return (
    <Box sx={{ position: 'absolute', left: 4, right: 4, top: 3, bottom: 2, zIndex: 1, display: 'flex', flexDirection: 'column', gap: 0.25, overflow: 'hidden' }}>
      {visible.map((event, idx) => {
        const timeLabel = formatClock(event.date.getHours(), event.date.getMinutes(), i18n.language);
        return (
          <Tooltip key={`${event.workflow.id}-${event.date.getTime()}-${idx}`} title={<EventTooltipBody event={event} />} placement="top" arrow>
            <Box
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-workflow-id', event.workflow.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onSelectWorkflow?.(event.workflow.id, event.date)}
              onContextMenu={(e) => onContextWorkflow?.(event.workflow, e)}
              sx={{
                height: 15,
                bgcolor: accent,
                color: '#fff',
                border: `1px solid ${accent}`,
                borderRadius: c.radius.sm,
                px: 0.55, py: 0,
                fontSize: eventFontSize, fontWeight: 600, lineHeight: '13px',
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.35,
                opacity: paused ? 0.45 : 1,
                boxSizing: 'border-box',
                '&:hover': { bgcolor: accent },
              }}>
              <span style={{ display: 'block', lineHeight: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{event.workflow.title}</span>
              <span style={{ display: 'block', lineHeight: '13px', color: 'inherit', opacity: 0.85, flexShrink: 0 }}>{timeLabel}</span>
            </Box>
          </Tooltip>
        );
      })}
      {rest.length > 0 && (
        <Box
          onClick={(e) => setAnchor(e.currentTarget)}
          role="button"
          sx={{
            alignSelf: 'flex-start',
            color: c.text.muted,
            fontSize: eventFontSize,
            fontWeight: 600,
            lineHeight: 1,
            cursor: 'pointer',
            px: 0.35,
            '&:hover': { color: accent },
          }}>
          {t('workflows.calendar.moreCount', { n: rest.length })}
        </Box>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ minWidth: 220, p: 1 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', mb: 0.5 }}>
            {t('workflows.calendar.moreAtThisHour', { n: rest.length })}
          </Typography>
          {rest.map((e, idx) => (
            <Box
              key={`${e.workflow.id}-${idx}`}
              onClick={() => { setAnchor(null); onSelectWorkflow?.(e.workflow.id, e.date); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 0.5, borderRadius: `${c.radius.md}px`, cursor: 'pointer', '&:hover': { bgcolor: c.bg.elevated } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', boxSizing: 'border-box', bgcolor: accent, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.82rem', color: c.text.primary, fontWeight: 600 }}>{e.workflow.title}</Typography>
              <Typography sx={{ fontSize: '0.74rem', color: c.text.muted }}>{formatClock(e.date.getHours(), e.date.getMinutes(), i18n.language)}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}

// "+N more" on a packed month cell opens a scrollable popover listing every run that day, so a heavy day isn't a dead end. Past fires keep the hollow ring the cell rows use, for a consistent at-a-glance "already ran" read.
export function MonthDayOverflow({ date, count, events, now, fontSize, onSelectWorkflow }: {
  date: Date;
  count: number;
  events: { workflow: Workflow; date: Date }[];
  now: Date;
  fontSize: string;
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
}) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const accent = c.accent.primary;
  return (
    <>
      <Typography
        onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
        role="button"
        sx={{ fontSize, color: c.text.muted, mt: 0.3, pl: 1.4, cursor: 'pointer', '&:hover': { color: accent } }}>
        {t('workflows.calendar.plusMore', { n: count })}
      </Typography>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
        <Box sx={{ minWidth: 240, maxHeight: 360, overflowY: 'auto', p: 1 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', mb: 0.5 }}>
            {t('workflows.calendar.scheduledOn', {
              n: events.length,
              date: date.toLocaleString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' }),
            })}
          </Typography>
          {events.map((e, idx) => (
            <Box
              key={`${e.workflow.id}-${idx}`}
              onClick={() => { setAnchor(null); onSelectWorkflow?.(e.workflow.id, e.date); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 0.5, borderRadius: `${c.radius.md}px`, cursor: 'pointer', '&:hover': { bgcolor: c.bg.elevated } }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', boxSizing: 'border-box', bgcolor: accent, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.82rem', color: c.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.workflow.title}</Typography>
              <Typography sx={{ fontSize: '0.74rem', color: c.text.muted, flexShrink: 0 }}>{formatClock(e.date.getHours(), e.date.getMinutes(), i18n.language)}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
}

export function EventTooltipBody({ event }: { event: { workflow: Workflow; date: Date } }) {
  const { t, i18n } = useTranslation();
  const wf = event.workflow;
  const status = wf.last_run_status;
  const cost = wf.cost_estimate?.last_run_usd;
  const monthly = wf.cost_estimate?.monthly_usd;
  return (
    <Box sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700 }}>{wf.title}</div>
      <div>{t('workflows.calendar.firesAt', { time: formatClock(event.date.getHours(), event.date.getMinutes(), i18n.language) })}</div>
      {status && <div>{t('workflows.calendar.lastRun', { status: labelForStatus(status, t) })}</div>}
      {typeof cost === 'number' && cost > 0 && <div>{t('workflows.calendar.lastRunCost', { cost: cost.toFixed(4) })}</div>}
      {typeof monthly === 'number' && monthly > 0 && <div>{t('workflows.calendar.estMonthly', { cost: monthly.toFixed(2) })}</div>}
    </Box>
  );
}

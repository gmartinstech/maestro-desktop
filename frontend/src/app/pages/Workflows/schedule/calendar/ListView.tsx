import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { formatClock } from '@/app/pages/Workflows/schedule/scheduleUtils';
import { useWindowedList } from '@/shared/hooks/useWindowedList';
import type { ListRow } from './types';

interface Props {
  rows: ListRow[];
  windowing: ReturnType<typeof useWindowedList>;
  locale: string;
  weekdayShort: string[];
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
  onContextWorkflow: (workflow: Workflow, e: React.MouseEvent) => void;
  ctxMenuEl: React.ReactNode;
}

// Apple-Calendar-style list: each day is a stacked group with the date as a header and its events listed underneath, so a busy day stays readable top to bottom instead of crammed beside a date column. Today renders even with no events (shows a "No events today" placeholder) so the list doesn't feel empty for new users. Off-screen day groups unmount (useWindowedList) and leave a measured-height spacer behind, so a dense schedule stays light no matter how far down you scroll.
export default function ListView({ rows, windowing, locale, weekdayShort, onSelectWorkflow, onContextWorkflow, ctxMenuEl }: Props) {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const accent = c.accent.primary;
  const visibleRows = rows.slice(windowing.start, windowing.end);
  return (
    <Box
      ref={windowing.setScrollEl}
      onScroll={windowing.onScroll}
      sx={{ display: 'flex', flexDirection: 'column', maxHeight: '100%', overflow: 'auto', overflowAnchor: 'auto', bgcolor: c.bg.surface }}>
      {rows.length === 0 && (
        <Typography sx={{ fontSize: '0.85rem', color: c.text.muted, textAlign: 'center', py: 3 }}>{t('workflows.calendar.noScheduled')}</Typography>
      )}
      {windowing.topSpacer > 0 && (
        <Box aria-hidden sx={{ height: windowing.topSpacer, flexShrink: 0, overflowAnchor: 'none' }} />
      )}
      {visibleRows.map((row, i) => {
        const rowIdx = windowing.start + i;
        if (row.kind === 'header') {
          return (
            <Box
              key={row.id}
              data-wl-id={row.id}
              sx={{
                display: 'flex', alignItems: 'baseline', gap: 0.75,
                px: 2, pt: rowIdx === 0 ? 1.5 : 2, pb: 0.5,
                borderTop: rowIdx === 0 ? 'none' : `1px dashed ${c.border.subtle}`,
              }}>
              <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, color: row.isToday ? accent : c.text.primary, lineHeight: 1, letterSpacing: '-0.01em' }}>
                {row.date.getDate()}
              </Typography>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: row.isToday ? accent : c.text.secondary, lineHeight: 1 }}>
                {weekdayShort[row.date.getDay()]}
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: c.text.muted, lineHeight: 1 }}>
                {row.date.toLocaleString(locale, { month: 'short' })}
              </Typography>
            </Box>
          );
        }
        if (row.kind === 'empty') {
          return (
            <Box key={row.id} data-wl-id={row.id} sx={{ px: 2, pb: 1 }}>
              <Typography sx={{ fontSize: '0.85rem', color: c.text.ghost }}>{t('workflows.calendar.noEventsToday')}</Typography>
            </Box>
          );
        }
        const e = row.ev;
        return (
          <Box
            key={row.id}
            data-wl-id={row.id}
            onClick={() => onSelectWorkflow?.(e.workflow.id, e.date)}
            onContextMenu={(ev) => onContextWorkflow(e.workflow, ev)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25,
              px: 2, py: 0.4,
              color: c.text.secondary, cursor: 'pointer',
              '&:hover .ev-title': { color: accent },
            }}>
            <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 22, bgcolor: accent, borderRadius: c.radius.sm, flexShrink: 0 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography className="ev-title" sx={{ fontSize: '0.9rem', fontWeight: 500, color: c.text.primary, lineHeight: 1.3 }}>{e.workflow.title}</Typography>
              <Typography sx={{ fontSize: '0.78rem', color: c.text.muted, lineHeight: 1.3 }}>{formatClock(e.date.getHours(), e.date.getMinutes(), locale)}</Typography>
            </Box>
          </Box>
        );
      })}
      {windowing.bottomSpacer > 0 && (
        <Box aria-hidden sx={{ height: windowing.bottomSpacer, flexShrink: 0, overflowAnchor: 'none' }} />
      )}
      {ctxMenuEl}
    </Box>
  );
}

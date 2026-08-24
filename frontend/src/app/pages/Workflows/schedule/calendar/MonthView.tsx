import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { addDays, formatClock, sameDay, startOfMonthGrid } from '@/app/pages/Workflows/schedule/scheduleUtils';
import { MonthDayOverflow } from './EventPopovers';
import type { EventsByDay } from './types';

interface Props {
  today: Date;
  now: Date;
  compact: boolean;
  eventFs: string;
  locale: string;
  weekdayShort: string[];
  eventsByDay: EventsByDay;
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
  onContextWorkflow: (workflow: Workflow, e: React.MouseEvent) => void;
  ctxMenuEl: React.ReactNode;
}

export default function MonthView({
  today, now, compact, eventFs, locale, weekdayShort, eventsByDay,
  onSelectWorkflow, onContextWorkflow, ctxMenuEl,
}: Props) {
  const c = useClaudeTokens();
  const start = startOfMonthGrid(today);
  const cells = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const accent = c.accent.primary;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Sticky weekday header so it stays visible even when the
          calendar body scrolls. Slightly bigger + tinted bg so it
          reads cleanly in both light and dark themes. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flexShrink: 0, position: 'sticky', top: 0, bgcolor: c.bg.surface, zIndex: 2, borderBottom: `1px solid ${c.border.subtle}`, pt: 1.25, pb: 0.6 }}>
        {weekdayShort.map((l, i) => (
          <Typography key={`${l}-${i}`} sx={{ textAlign: 'center', fontSize: '0.74rem', color: c.text.muted, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{l}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(5, minmax(${compact ? 70 : 96}px, 1fr))`, flex: 1, minHeight: 0, gap: 0, borderLeft: `1px solid ${c.border.subtle}` }}>
        {cells.map((d) => {
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const evs = eventsByDay.map.get(key) || [];
          const isToday = sameDay(d, now);
          const inMonth = d.getMonth() === today.getMonth();
          return (
            <Box key={d.toISOString()} sx={{ borderRight: `1px solid ${c.border.subtle}`, borderBottom: `1px solid ${c.border.subtle}`, p: 0.5, position: 'relative', overflow: 'hidden', bgcolor: inMonth ? 'transparent' : c.bg.elevated }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                {/* Out-of-month dates still need to be legible (Apple
                    Calendar shows them in a muted shade, not invisible).
                    Color tweak instead of opacity so dark themes stay
                    readable. */}
                <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box', width: 22, height: 22, borderRadius: '50%', bgcolor: isToday ? accent : 'transparent', color: isToday ? '#fff' : inMonth ? c.text.primary : c.text.ghost, fontWeight: isToday ? 600 : 500, fontSize: '0.82rem', lineHeight: 1, boxShadow: isToday ? `0 0 0 1.5px ${c.bg.surface}, 0 0 0 3px ${accent}` : 'none' }}>{d.getDate()}</Box>
              </Box>
              {evs.slice(0, compact ? 3 : 4).map((e, idx) => (
                <Box
                  key={`${e.workflow.id}-${idx}`}
                  onClick={() => onSelectWorkflow?.(e.workflow.id, e.date)}
                  onContextMenu={(ev) => onContextWorkflow(e.workflow, ev)}
                  sx={{ mt: 0.3, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: eventFs, color: c.text.primary, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', '&:hover': { color: accent } }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', boxSizing: 'border-box', bgcolor: accent, flexShrink: 0 }} />
                  <span style={{ color: c.text.muted, flexShrink: 0 }}>{formatClock(e.date.getHours(), e.date.getMinutes(), locale)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 500 }}>{e.workflow.title}</span>
                </Box>
              ))}
              {evs.length > (compact ? 3 : 4) && (
                <MonthDayOverflow
                  date={d}
                  count={evs.length - (compact ? 3 : 4)}
                  events={evs}
                  now={now}
                  fontSize={eventFs}
                  onSelectWorkflow={onSelectWorkflow}
                />
              )}
            </Box>
          );
        })}
      </Box>
      {ctxMenuEl}
    </Box>
  );
}

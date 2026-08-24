import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAppDispatch } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { updateWorkflow } from '@/shared/state/workflowsSlice';
import { addDays, formatHourLabel, sameDay, startOfWeek } from '@/app/pages/Workflows/schedule/scheduleUtils';
import { EventStack } from './EventPopovers';
import { HOURS_24 } from './types';
import type { EventsByDay } from './types';

interface Props {
  today: Date;
  now: Date;
  compact: boolean;
  slotH: number;
  rowLabelFs: string;
  dayNumFs: string;
  dayLabelFs: string;
  eventFs: string;
  locale: string;
  weekdayShort: string[];
  eventsByDay: EventsByDay;
  workflows: Workflow[];
  allPaused: boolean;
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
  onContextWorkflow: (workflow: Workflow, e: React.MouseEvent) => void;
  ctxMenuEl: React.ReactNode;
}

export default function WeekView({
  today, now, compact, slotH, rowLabelFs, dayNumFs, dayLabelFs, eventFs,
  locale, weekdayShort, eventsByDay, workflows, allPaused,
  onSelectWorkflow, onContextWorkflow, ctxMenuEl,
}: Props) {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const start = startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const HOURS = HOURS_24;
  const nowColIdx = days.findIndex((d) => sameDay(d, now));
  const nowTopPx = (now.getHours() + now.getMinutes() / 60) * slotH;
  // Prefer the short zone name ("PDT", "EST", "JST") over "GMT-7", in the active locale. formatToParts is wide-supported; if it ever fails we degrade silently rather than show a confusing fallback.
  const TZ_LABEL = (() => {
    try {
      const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value || '';
    } catch { return ''; }
  })();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', color: c.text.secondary }}>
      {/* Day headers: muted weekday caps; today's date gets the filled circle */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '64px repeat(7, 1fr)',
        gap: 0,
        position: 'sticky',
        top: 0,
        bgcolor: c.bg.surface,
        zIndex: 20,
        borderBottom: `1px solid ${c.border.subtle}`,
        pt: 1.25,
        pb: 0.5,
        overflow: 'hidden',
        isolation: 'isolate',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '-1px',
          bgcolor: c.bg.surface,
          zIndex: 0,
        },
        '& > *': { position: 'relative', zIndex: 1 },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', pr: 1, pb: 0.5 }}>
          {!compact && (
            <Typography sx={{ fontSize: '0.62rem', color: c.text.ghost, fontWeight: 500 }}>{TZ_LABEL}</Typography>
          )}
        </Box>
        {days.map((d) => {
          const isToday = sameDay(d, now);
          return (
            <Box key={d.toISOString()} sx={{ textAlign: 'center', pb: 0.5 }}>
              <Typography sx={{ fontSize: dayLabelFs, color: c.text.muted, fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.3, textTransform: 'uppercase' }}>
                {weekdayShort[d.getDay()]}
              </Typography>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box', width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: '50%', bgcolor: isToday ? c.accent.primary : 'transparent', color: isToday ? '#fff' : c.text.primary, fontWeight: isToday ? 600 : 500, fontSize: dayNumFs, lineHeight: 1, mt: 0.25, boxShadow: isToday ? `0 0 0 1.5px ${c.bg.surface}, 0 0 0 3px ${c.accent.primary}` : 'none' }}>{d.getDate()}</Box>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '64px repeat(7, 1fr)', position: 'relative', zIndex: 0 }}>
        {HOURS.map((hour, hourIdx) => (
          <React.Fragment key={hour}>
            {/* Hour label sits inside its row (top-aligned) rather than
                straddling the line above it; that way the first row
                doesn't clip "12 AM" and the labels never drift when the
                body scrolls. Apple Calendar does the same. */}
            <Box sx={{
              height: slotH, fontSize: rowLabelFs,
              color: c.text.ghost, fontWeight: 500,
              textAlign: 'right', pr: 1, pt: 0.25,
              borderTop: hourIdx === 0 ? 'none' : `1px solid ${c.border.subtle}`,
            }}>
              {formatHourLabel(hour, locale)}
            </Box>
            {days.map((d) => {
              const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              const evs = (eventsByDay.map.get(key) || []).filter((e) => e.date.getHours() === hour);
              const targetWeekday = d.getDay();
              return (
                <Box
                  key={`${d.toISOString()}-${hour}`}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const wid = e.dataTransfer.getData('application/x-workflow-id');
                    if (!wid) return;
                    const wf = workflows.find((w) => w.id === wid);
                    if (!wf) return;
                    // Build the patched schedule: new hour, and for weekly schedules swap on_days to just the target weekday. Daily/monthly only get the new hour.
                    const sched = { ...wf.schedule, hour } as typeof wf.schedule;
                    if (sched.repeat_unit === 'week') sched.on_days = [targetWeekday];
                    dispatch(updateWorkflow({
                      id: wf.id,
                      patch: { schedule: sched as any },
                      ifMatch: wf.updated_at || null,
                    }));
                  }}
                  sx={{ height: slotH, borderLeft: `1px solid ${c.border.subtle}`, borderTop: hourIdx === 0 ? 'none' : `1px solid ${c.border.subtle}`, position: 'relative', overflow: 'hidden' }}>
                  <EventStack
                    events={evs}
                    paused={allPaused}
                    now={now}
                    maxVisible={compact ? 1 : 3}
                    onSelectWorkflow={onSelectWorkflow}
                    eventFontSize={eventFs}
                    onContextWorkflow={onContextWorkflow}
                  />
                </Box>
              );
            })}
          </React.Fragment>
        ))}
        {nowColIdx >= 0 && (
          <Box sx={{
            position: 'absolute', pointerEvents: 'none', zIndex: 3,
            top: `${nowTopPx}px`,
            left: `calc(64px + ${nowColIdx} * ((100% - 64px) / 7))`,
            width: 'calc((100% - 64px) / 7)',
            height: 0, borderTop: `2px solid ${c.status.error}`,
          }}>
            <Box sx={{ position: 'absolute', left: -3, top: -4, width: 7, height: 7, borderRadius: '50%', bgcolor: c.status.error }} />
          </Box>
        )}
      </Box>
      {ctxMenuEl}
    </Box>
  );
}

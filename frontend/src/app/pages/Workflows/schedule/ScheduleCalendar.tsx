import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { API_BASE } from '@/shared/config';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { runWorkflowNow, deleteWorkflow, updateWorkflow, openWorkflowCard } from '@/shared/state/workflowsSlice';
import { addWorkflowCard } from '@/shared/state/dashboardLayoutSlice';
import { addDays, sameDay, startOfMonthGrid, startOfWeek, stepsSignature } from './scheduleUtils';
import { useWindowedList } from '@/shared/hooks/useWindowedList';
import { LIST_WINDOW_MIN_ROWS, weekdayNames } from './calendar/types';
import type { CalendarEvent, ListRow } from './calendar/types';
import WeekView from './calendar/WeekView';
import MonthView from './calendar/MonthView';
import ListView from './calendar/ListView';

interface Props {
  view: 'Week' | 'Month' | 'List';
  density: 'compact' | 'roomy';
  onSelectWorkflow?: (id: string, fireAt?: Date) => void;
  refDate?: Date;
}

export default function ScheduleCalendar({ view, density, onSelectWorkflow, refDate }: Props) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const weekdayShort = useMemo(() => weekdayNames(locale), [locale]);
  const dispatch = useAppDispatch();
  const workflows = useAppSelector((s) => Object.values(s.workflows.items));
  const allPaused = useAppSelector((s) => s.workflows.paused);
  // Live clock for the "now" line; a snapshot would drift and refDate may be a navigated week, so it can't double as the current moment.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Right-click menu: pinned position + the workflow whose pill was clicked. Same anchor pattern as MUI's menu examples.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; workflow: Workflow } | null>(null);
  const closeMenu = () => setCtxMenu(null);
  const onContextWorkflow = useCallback((workflow: Workflow, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, workflow });
  }, []);
  const onRunNow = () => {
    if (!ctxMenu) return;
    dispatch(runWorkflowNow({
      id: ctxMenu.workflow.id,
      signature: stepsSignature(ctxMenu.workflow.steps),
    }));
    closeMenu();
  };
  const onPauseToggle = () => {
    if (!ctxMenu) return;
    const wf = ctxMenu.workflow;
    dispatch(updateWorkflow({
      id: wf.id,
      patch: { schedule: { ...wf.schedule, enabled: !wf.schedule.enabled } as any },
      ifMatch: wf.updated_at || null,
    }));
    closeMenu();
  };
  const onEdit = () => {
    if (!ctxMenu) return;
    dispatch(addWorkflowCard({ workflowId: ctxMenu.workflow.id }));
    // Right-click "Edit" on a calendar entry opens the new Edit Agent chat view, matching the post-revamp design (Image #38).
    dispatch(openWorkflowCard({ workflowId: ctxMenu.workflow.id, view: 'edit_agent' }));
    closeMenu();
  };
  const onDelete = () => {
    if (!ctxMenu) return;
    const ok = window.confirm(t('workflows.calendar.deleteConfirm', { title: ctxMenu.workflow.title }));
    if (!ok) { closeMenu(); return; }
    dispatch(deleteWorkflow(ctxMenu.workflow.id));
    closeMenu();
  };
  const ctxMenuEl = (
    <Menu
      open={Boolean(ctxMenu)}
      onClose={closeMenu}
      anchorReference="anchorPosition"
      anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}>
      <MenuItem onClick={onRunNow}>{t('workflows.calendar.runNow')}</MenuItem>
      <MenuItem onClick={onPauseToggle}>{ctxMenu?.workflow.schedule.enabled ? t('workflows.calendar.pauseSchedule') : t('workflows.calendar.resumeSchedule')}</MenuItem>
      <MenuItem onClick={onEdit}>{t('workflows.calendar.edit')}</MenuItem>
      <MenuItem onClick={onDelete} sx={{ color: c.status.error }}>{t('common.delete')}</MenuItem>
    </Menu>
  );
  // refDate is recreated on every render unless the caller memoizes it. Pin the calendar to a day-precision key so occurrence fetches only change when the visible day, view, or schedule set changes.
  const today = refDate || new Date();
  const dayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const compact = density === 'compact';
  const range = view === 'Month' ? 35 : view === 'Week' ? 7 : 14;
  const rangeStart = useMemo(
    () => view === 'Month' ? startOfMonthGrid(today) : view === 'Week' ? startOfWeek(today) : new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, dayKey],
  );
  const rangeEndExclusive = useMemo(() => addDays(rangeStart, range), [rangeStart, range]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarFetchKey, setCalendarFetchKey] = useState('');
  // Key off only the fields that change which occurrences exist. Deliberately NOT updated_at: the scheduler bumps it every tick (recomputing next_run_at) and pushes a workflow:updated over the socket, which would churn this key and blank the calendar (the eventsByDay gate) until the next fetch lands.
  const workflowScheduleKey = workflows
    .map((w) => `${w.id}:${w.schedule.enabled}:${w.schedule.timezone}:${w.schedule.repeat_unit}:${w.schedule.repeat_every}:${w.schedule.hour}:${w.schedule.minute}:${w.schedule.day_of_month ?? ''}:${w.schedule.on_days.join(',')}:${w.schedule.ends_at || ''}:${w.schedule.max_runs ?? ''}:${w.schedule.runs_count}`)
    .sort()
    .join('|');
  const fromIso = rangeStart.toISOString();
  const toIso = rangeEndExclusive.toISOString();
  const calendarRequestKey = `${view}:${fromIso}:${toIso}:${workflowScheduleKey}`;
  // The visible window alone decides whether shown events are even plausible. Gating on this (not the full request key) means a schedule edit refetches without blanking the calendar first: we keep the current events until the fresh ones land. Only a view/date change, where old events are for the wrong window, clears them.
  const calendarWindowKey = `${view}:${fromIso}:${toIso}`;

  useEffect(() => {
    // No AbortController: the global fetch interceptor (shared/config) dedupes GETs by URL onto ONE underlying request, so aborting on cleanup (which fires when this effect re-runs as workflows hydrate) rejects the shared request and the re-fired fetch with it, leaving the calendar empty on first load. The `cancelled` guard already stops stale state writes.
    let cancelled = false;
    fetch(`${API_BASE}/workflows/calendar?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`calendar failed ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setCalendarEvents((data.events || []) as CalendarEvent[]);
        setCalendarFetchKey(calendarWindowKey);
      })
      .catch(() => {
        if (cancelled) return;
        setCalendarFetchKey(calendarWindowKey);
      });
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, calendarRequestKey]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { workflow: Workflow; date: Date }[]>();
    if (calendarFetchKey !== calendarWindowKey) {
      return { map, start: rangeStart, end: rangeEndExclusive, key: calendarFetchKey };
    }
    const workflowById = new Map(workflows.map((wf) => [wf.id, wf]));
    for (const event of calendarEvents) {
      const wf = workflowById.get(event.workflow_id);
      if (!wf) continue;
      const d = new Date(event.fire_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push({ workflow: wf, date: d });
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    return { map, start: rangeStart, end: rangeEndExclusive, key: calendarFetchKey };
  }, [calendarEvents, calendarFetchKey, calendarWindowKey, workflows, rangeStart, rangeEndExclusive]);

  // List view can fan out to ~1300 rows for a dense schedule (every 15 min over 14 days). Flatten days into rows and window at the row level so off-screen rows unmount instead of weighing the whole app down. Computed up here (not in the List branch) so the windowing hook runs before the Week/Month early returns.
  const upcoming = useMemo(() => {
    const out: { date: Date; events: { workflow: Workflow; date: Date }[]; isToday: boolean }[] = [];
    for (let i = 0; i < 14; i += 1) {
      const day = addDays(today, i);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const arr = eventsByDay.map.get(key) || [];
      const isToday = sameDay(day, today);
      if (arr.length || isToday) out.push({ date: day, events: arr, isToday });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsByDay, dayKey]);
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const day of upcoming) {
      const iso = day.date.toISOString();
      out.push({ kind: 'header', id: `h:${iso}`, date: day.date, isToday: day.isToday });
      if (day.events.length === 0) {
        out.push({ kind: 'empty', id: `x:${iso}` });
      } else {
        for (const ev of day.events) {
          out.push({ kind: 'event', id: `${iso}#${ev.workflow.id}#${ev.date.getTime()}`, ev });
        }
      }
    }
    return out;
  }, [upcoming]);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const estimateRowHeight = useCallback((index: number) => {
    const r = rows[index];
    if (!r) return 41;
    return r.kind === 'header' ? 52 : r.kind === 'empty' ? 36 : 41;
  }, [rows]);
  const windowing = useWindowedList({
    ids: rowIds,
    estimateHeight: estimateRowHeight,
    enabled: view === 'List' && rows.length >= LIST_WINDOW_MIN_ROWS,
  });

  const SLOT_H = compact ? 40 : 60;
  const ROW_LABEL = compact ? '0.7rem' : '0.74rem';
  const DAY_NUM = compact ? '0.95rem' : '1.15rem';
  const DAY_LABEL = compact ? '0.66rem' : '0.72rem';
  const EVENT_FS = compact ? '0.56rem' : '0.58rem';

  if (view === 'Week') {
    return (
      <WeekView
        today={today}
        now={now}
        compact={compact}
        slotH={SLOT_H}
        rowLabelFs={ROW_LABEL}
        dayNumFs={DAY_NUM}
        dayLabelFs={DAY_LABEL}
        eventFs={EVENT_FS}
        locale={locale}
        weekdayShort={weekdayShort}
        eventsByDay={eventsByDay}
        workflows={workflows}
        allPaused={allPaused}
        onSelectWorkflow={onSelectWorkflow}
        onContextWorkflow={onContextWorkflow}
        ctxMenuEl={ctxMenuEl}
      />
    );
  }

  if (view === 'Month') {
    return (
      <MonthView
        today={today}
        now={now}
        compact={compact}
        eventFs={EVENT_FS}
        locale={locale}
        weekdayShort={weekdayShort}
        eventsByDay={eventsByDay}
        onSelectWorkflow={onSelectWorkflow}
        onContextWorkflow={onContextWorkflow}
        ctxMenuEl={ctxMenuEl}
      />
    );
  }

  return (
    <ListView
      rows={rows}
      windowing={windowing}
      locale={locale}
      weekdayShort={weekdayShort}
      onSelectWorkflow={onSelectWorkflow}
      onContextWorkflow={onContextWorkflow}
      ctxMenuEl={ctxMenuEl}
    />
  );
}

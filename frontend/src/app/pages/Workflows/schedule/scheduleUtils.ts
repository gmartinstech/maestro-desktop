import type { TFunction } from 'i18next';
import type { Workflow, ScheduleConfig, WorkflowStep } from '@/shared/state/workflowsSlice';

// Weekday names come from Intl, not a hand-built table, so they follow the active language. 2023-01-01 was a Sunday, so index 0..6 lines up with Date.getDay().
export function weekdayNames(locale: string, width: 'short' | 'long' | 'narrow' = 'short'): string[] {
  try {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: width });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  } catch { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; }
}

export function defaultSchedule(): ScheduleConfig {
  // Pick the host's IANA tz so new schedules start with an explicit zone instead of the legacy "local" sentinel. Backend storage still coerces "local" if a record predates this default; new records skip that path.
  let tz = 'local';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { /* keep 'local' */ }
  return {
    enabled: false,
    repeat_every: 1,
    repeat_unit: 'week',
    on_days: [],
    hour: 9,
    minute: 0,
    day_of_month: null,
    timezone: tz,
    ends_at: null,
    max_runs: null,
    runs_count: 0,
  };
}

export function isScheduleConfigured(sched: ScheduleConfig | null | undefined): boolean {
  if (!sched) return false;
  if (sched.repeat_unit === 'week') return sched.on_days.length > 0;
  return true;
}

export function isScheduleActive(sched: ScheduleConfig | null | undefined): boolean {
  return !!sched?.enabled && isScheduleConfigured(sched);
}

export function isWorkflowSchedulable(workflow: Workflow): boolean {
  return isScheduleConfigured(workflow.schedule);
}

// Stable fingerprint of the steps that actually drive behavior (order + id + text). label is just the at-a-glance headline, so it's left out. Computed only here so the backend stores exactly what the FE compares: no cross- language hashing drift.
export function stepsSignature(steps: WorkflowStep[] | null | undefined): string {
  return JSON.stringify((steps || []).map((s) => [s.id, s.text]));
}

// True when the current steps haven't been validated by a test run (or seeded at chat conversion) since they were last edited. Drives the test-first warning before scheduling.
export function needsScheduleTestWarning(workflow: Workflow): boolean {
  const steps = workflow.draft_steps ?? workflow.steps;
  if (!steps || steps.length === 0) return false;
  return stepsSignature(steps) !== (workflow.tested_signature ?? '');
}

// Clock label straight from Intl so pt-BR renders 24h ("15:00") and en keeps 12h am/pm, instead of hand-rolling a suffix.
export function formatClock(hour: number, minute: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute));
  } catch { return `${hour}:${String(minute).padStart(2, '0')}`; }
}

// Left-column hour label in the hub calendar grid ("10 AM" in en, "10" in pt-BR).
export function formatHourLabel(hour: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
  } catch { return String(hour); }
}

/** The one schedule sentence for the whole app: hub rail, saved card, and app-shell card all render this. */
export function describeSchedule(sched: ScheduleConfig, t: TFunction, locale: string): string {
  const k = 'workflows.schedule';
  if (!sched.enabled || !isScheduleConfigured(sched)) return t(`${k}.notScheduled`);
  const time = formatClock(sched.hour, sched.minute, locale);
  if (sched.repeat_unit === 'minute') return t(`${k}.everyMinutes`, { count: sched.repeat_every });
  if (sched.repeat_unit === 'hour') {
    const at = sched.minute === 0 ? '' : t(`${k}.atMinute`, { minute: String(sched.minute).padStart(2, '0') });
    return sched.repeat_every === 1 ? t(`${k}.hourly`, { at }) : t(`${k}.everyHours`, { count: sched.repeat_every, at });
  }
  if (sched.repeat_unit === 'day') {
    return sched.repeat_every === 1 ? t(`${k}.everyDayAt`, { time }) : t(`${k}.everyDaysAt`, { count: sched.repeat_every, time });
  }
  if (sched.repeat_unit === 'month') {
    const day = sched.day_of_month ? t(`${k}.onDayOfMonth`, { day: sched.day_of_month }) : '';
    return sched.repeat_every === 1 ? t(`${k}.everyMonthAt`, { day, time }) : t(`${k}.everyMonthsAt`, { count: sched.repeat_every, day, time });
  }
  if (sched.on_days.length === 0) return t(`${k}.weeklyAt`, { time });
  if (sched.on_days.length === 5 && [1, 2, 3, 4, 5].every((d) => sched.on_days.includes(d))) return t(`${k}.weekdaysAt`, { time });
  if (sched.on_days.length === 2 && [0, 6].every((d) => sched.on_days.includes(d))) return t(`${k}.weekendsAt`, { time });
  // A single day reads as a plural weekday ("Mondays at 3pm" / "Segundas às 15:00"), which Intl can't produce, so the plural forms live as their own keys.
  if (sched.on_days.length === 1) return t(`${k}.singleDayAt`, { day: t(`${k}.dayPlural.${sched.on_days[0]}`), time });
  const days = sched.on_days.slice().sort().map((d) => weekdayNames(locale)[d]).join(', ');
  return sched.repeat_every === 1 ? t(`${k}.weeklyDaysAt`, { days, time }) : t(`${k}.weeklyEveryNAt`, { count: sched.repeat_every, days, time });
}

/** Compact schedule for the hub pill chip, where the full sentence would not fit. */
export function describeScheduleShort(sched: ScheduleConfig, t: TFunction, locale: string): string {
  const k = 'workflows.schedule.short';
  if (!sched.enabled || !isScheduleConfigured(sched)) return t('workflows.schedule.notScheduled');
  const time = formatClock(sched.hour, sched.minute, locale);
  if (sched.repeat_unit === 'minute') return t(`${k}.everyMinutes`, { count: sched.repeat_every });
  if (sched.repeat_unit === 'hour') return sched.repeat_every === 1 ? t(`${k}.hourly`) : t(`${k}.everyHours`, { count: sched.repeat_every });
  if (sched.repeat_unit === 'day') return sched.repeat_every === 1 ? t(`${k}.daily`, { time }) : t(`${k}.everyDays`, { count: sched.repeat_every, time });
  if (sched.repeat_unit === 'month') {
    const day = sched.day_of_month ? t(`${k}.dayOfMonth`, { day: sched.day_of_month }) : '';
    return sched.repeat_every === 1 ? t(`${k}.monthly`, { day, time }) : t(`${k}.everyMonths`, { count: sched.repeat_every, day, time });
  }
  if (sched.on_days.length === 5 && [1, 2, 3, 4, 5].every((d) => sched.on_days.includes(d))) return t(`${k}.weekdays`, { time });
  if (sched.on_days.length === 2 && [0, 6].every((d) => sched.on_days.includes(d))) return t(`${k}.weekends`, { time });
  if (sched.on_days.length === 1) return `${weekdayNames(locale)[sched.on_days[0]]} ${time}`;
  return t(`${k}.timesPerWeek`, { count: sched.on_days.length, time });
}

export function describePermissions(workflow: Workflow, t: TFunction): string {
  const k = 'workflows.permissions';
  if (!workflow.permissions || workflow.permissions.length === 0) return t(`${k}.notifyOnly`);
  const labels: string[] = [];
  for (const p of workflow.permissions) {
    if (p.kind === 'notify') labels.push(t(`${k}.notifyInApp`));
    else if (p.kind === 'text') labels.push(t(`${k}.text`));
    else if (p.kind === 'call') labels.push(t(`${k}.call`));
  }
  return t(`${k}.firstThen`, { tiers: labels.join(t(`${k}.thenSeparator`)) });
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function startOfMonthGrid(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

import type { Workflow } from '@/shared/state/workflowsSlice';

// Both compact (popover) and roomy (hub) show the full 24 hours scrollable; the user explicitly wants midnight visible at the top, not "9am" as the starting hour. The scroll container caps the visible window.
export const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);

// At/above this many list rows (day headers + event rows), window the list so only near-viewport rows stay mounted. Below it, render whole; spacers aren't worth the churn on a short list.
export const LIST_WINDOW_MIN_ROWS = 60;

// Weekday names come from Intl so they follow the active language instead of a hard-coded English array. 2023-01-01 was a Sunday, so index 0..6 lines up with Date.getDay().
export function weekdayNames(locale: string): string[] {
  try {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  } catch { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; }
}

export interface CalendarEvent {
  workflow_id: string;
  fire_at: string;
}

// One flattened list row. Windowing unmounts at this granularity, so a dense single day no longer mounts all ~96 of its rows just for being near the viewport: only the rows actually in view (plus buffer) stay in the DOM.
export type ListRow =
  | { kind: 'header'; id: string; date: Date; isToday: boolean }
  | { kind: 'event'; id: string; ev: { workflow: Workflow; date: Date } }
  | { kind: 'empty'; id: string };

export interface EventsByDay {
  map: Map<string, { workflow: Workflow; date: Date }[]>;
  start: Date;
  end: Date;
  key: string;
}

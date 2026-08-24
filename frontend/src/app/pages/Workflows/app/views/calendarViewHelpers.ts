import type { CSSProperties } from 'react';
import { addDays } from '@/app/pages/Workflows/schedule/scheduleUtils';
import type { WCPalette } from '../shared/uiKit';

const DOW_REFERENCE_SUNDAY = new Date(2023, 0, 1); // a Sunday; Intl.DateTimeFormat only needs a correct day-of-week

// Locale-driven short weekday labels, index 0 = Sunday, to match Date#getDay(). Was a hardcoded
// English DOW array; Intl gives correct abbreviations (dom, seg, ter... in pt-BR) for free.
export function weekdayLabels(language: string): string[] {
  const fmt = new Intl.DateTimeFormat(language, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(DOW_REFERENCE_SUNDAY, i)).toUpperCase());
}

export function miniTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, '0')}${ap}`;
}

export function hourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export const moreStyle = (WC: WCPalette): CSSProperties => ({
  fontSize: 10.5, fontWeight: 600, color: WC.muted, padding: '2px 3px', borderRadius: 5,
  cursor: 'pointer', alignSelf: 'flex-start', border: 'none', background: 'transparent',
});

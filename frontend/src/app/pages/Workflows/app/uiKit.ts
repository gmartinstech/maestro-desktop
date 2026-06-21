import type { CSSProperties } from 'react';

// The Workflows app renders in its own warm-paper visual language (from the
// Claude design), deliberately separate from the MUI theme so the window reads
// as a focused app. All tokens live here so the panes stay consistent.
export const WC = {
  accent: '#C25A36',
  paper: '#FBFAF7',
  panel: '#F4F2EC',
  rail: '#F4F2EC',
  inset: '#F0EEE7',
  ink: '#211E1B',
  ink2: '#2B2722',
  ink3: '#4B463E',
  muted: '#8C857A',
  muted2: '#A39C92',
  faint: '#B5AEA3',
  line: 'rgba(33,30,27,0.07)',
  line2: 'rgba(33,30,27,0.12)',
  hover: 'rgba(33,30,27,0.045)',
  selBg: 'rgba(33,30,27,0.06)',
  success: '#2E7D5B',
  successBg: 'rgba(46,125,91,0.12)',
  danger: '#C2483A',
  dangerBg: 'rgba(194,72,58,0.10)',
  warn: '#B98A2E',
} as const;

export const FONT_SERIF = "'Newsreader', Georgia, serif";
export const FONT_SANS = "'Hanken Grotesk', system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

// Stable per-workflow color: the backend has no color field, so derive a
// vivid-but-deterministic swatch from the id. Same id always lands the same
// hue, so dots/bars stay consistent across panes without persistence.
export const WORKFLOW_PALETTE = [
  '#C25A36', '#3F8E83', '#5B6CB8', '#9A5B86',
  '#B5852E', '#C2483A', '#4B7A4B', '#4B463E',
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WORKFLOW_PALETTE[h % WORKFLOW_PALETTE.length];
}

export type RunStatus = 'success' | 'failure' | 'ran_late' | 'running' | 'skipped' | 'paused';

export function statusChip(status: RunStatus): CSSProperties {
  const map: Record<string, [string, string]> = {
    success: [WC.success, WC.successBg],
    ran_late: [WC.warn, 'rgba(185,138,46,0.14)'],
    failure: [WC.danger, 'rgba(194,72,58,0.12)'],
    skipped: [WC.muted, 'rgba(33,30,27,0.07)'],
    running: [WC.accent, 'rgba(0,0,0,0.04)'],
    paused: [WC.muted, 'rgba(33,30,27,0.07)'],
  };
  const [color, background] = map[status] || map.paused;
  return {
    fontSize: 11, fontWeight: 600, color, background,
    padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flex: 'none',
  };
}

export function statusDot(status: RunStatus): CSSProperties {
  const map: Record<string, string> = {
    success: WC.success, ran_late: WC.warn, failure: WC.danger,
    running: WC.accent, skipped: WC.faint, paused: WC.faint,
  };
  return { width: 8, height: 8, borderRadius: '50%', background: map[status] || WC.faint, flex: 'none' };
}

export function track(on: boolean): CSSProperties {
  return {
    width: 34, height: 20, borderRadius: 999, background: on ? WC.accent : '#D5D1C8',
    position: 'relative', cursor: 'pointer', transition: 'background .15s', flex: 'none',
  };
}

export function knob(on: boolean): CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
    background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)',
  };
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'success': return 'Success';
    case 'failure': return 'Failed';
    case 'ran_late': return 'Ran late';
    case 'running': return 'Running';
    case 'skipped': return 'Skipped';
    default: return 'Paused';
  }
}

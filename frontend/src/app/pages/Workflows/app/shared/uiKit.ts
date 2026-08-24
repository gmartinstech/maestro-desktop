import type { CSSProperties } from 'react';
import i18n from '@/shared/i18n/i18n';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';

export interface WCPalette {
  accent: string;
  paper: string;
  page: string;
  panel: string;
  rail: string;
  inset: string;
  raised: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  muted: string;
  muted2: string;
  faint: string;
  inkRGB: string;
  line: string;
  line2: string;
  hover: string;
  selBg: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warn: string;
  warnBg: string;
  trackOff: string;
  shadow: ClaudeTokens['shadow'];
  radius: ClaudeTokens['radius'];
  border: ClaudeTokens['border'];
}

export function useWC(): WCPalette {
  const c = useClaudeTokens();
  return {
    accent: c.accent.primary,
    ink: c.text.primary,
    ink2: c.text.secondary,
    ink3: c.text.muted,
    ink4: c.text.tertiary,
    muted: c.text.muted,
    muted2: c.text.tertiary,
    faint: c.text.ghost,
    // Convert RGB values from hex for rgba composition: light theme uses dark text, dark theme uses light text
    inkRGB: c.text.primary === '#1F2937' ? '31,41,55' : '249,250,251',
    line: c.border.subtle,
    line2: c.border.medium,
    hover: `${c.accent.primary}0A`,
    selBg: `${c.accent.primary}0F`,
    success: '#2E7D5B',
    successBg: 'rgba(46,125,91,0.12)',
    danger: '#C2483A',
    dangerBg: 'rgba(194,72,58,0.15)',
    warn: '#B98A2E',
    warnBg: 'rgba(185,138,46,0.15)',
    trackOff: c.border.strong,
    paper: c.bg.surface,
    page: c.bg.page,
    panel: c.bg.surface,
    rail: c.bg.secondary,
    inset: c.bg.page,
    raised: c.bg.elevated,
    shadow: c.shadow,
    radius: c.radius,
    border: c.border,
  };
}

export const FONT_SERIF = "'Newsreader', Georgia, serif";
export const FONT_SANS = "'Hanken Grotesk', system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

// Stable per-workflow color: the backend has no color field, so derive a vivid-but-deterministic swatch from the id. Same id always lands the same hue, so dots/bars stay consistent across panes without persistence.
export const WORKFLOW_PALETTE = [
  '#C25A36', '#3F8E83', '#5B6CB8', '#9A5B86',
  '#B5852E', '#C2483A', '#4B7A4B', '#4B463E',
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WORKFLOW_PALETTE[h % WORKFLOW_PALETTE.length];
}

// Prefer the user's chosen swatch; fall back to the stable id-hash hue when they haven't picked one. Single source of truth for every dot/bar.
export function colorForWorkflow(wf: { id: string; color?: string | null }): string {
  return wf.color || colorForId(wf.id);
}

export type RunStatus = 'success' | 'failure' | 'ran_late' | 'running' | 'skipped' | 'paused';

export function statusChip(status: RunStatus, wc: WCPalette): CSSProperties {
  const map: Record<string, [string, string]> = {
    success: [wc.success, wc.successBg],
    ran_late: [wc.warn, wc.warnBg],
    failure: [wc.danger, wc.dangerBg],
    skipped: [wc.muted, `rgba(${wc.inkRGB},0.07)`],
    running: [wc.accent, `rgba(${wc.inkRGB},0.06)`],
    paused: [wc.muted, `rgba(${wc.inkRGB},0.07)`],
  };
  const [color, background] = map[status] || map.paused;
  return {
    fontSize: 11, fontWeight: 600, color, background,
    padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flex: 'none',
  };
}

export function statusDot(status: RunStatus, wc: WCPalette): CSSProperties {
  const map: Record<string, string> = {
    success: wc.success, ran_late: wc.warn, failure: wc.danger,
    running: wc.accent, skipped: wc.faint, paused: wc.faint,
  };
  return { width: 8, height: 8, borderRadius: '50%', background: map[status] || wc.faint, flex: 'none' };
}

export function track(on: boolean, wc: WCPalette): CSSProperties {
  return {
    width: 34, height: 20, borderRadius: 999, background: on ? wc.accent : wc.trackOff,
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
    case 'success': return i18n.t('workflows.status.success');
    case 'failure': return i18n.t('workflows.status.failure');
    case 'ran_late': return i18n.t('workflows.status.ranLate');
    case 'running': return i18n.t('workflows.status.running');
    case 'skipped': return i18n.t('workflows.status.skipped');
    default: return i18n.t('workflows.status.paused');
  }
}

import React from 'react';
import type { TFunction } from 'i18next';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

export function statusColor(s: string, c: ReturnType<typeof useClaudeTokens>): string {
  if (s === 'success') return c.status.success;
  if (s === 'failure') return c.status.error;
  if (s === 'ran_late') return c.status.warning;
  if (s === 'running') return c.accent.primary;
  return c.text.muted;
}

export function statusBg(s: string, c: ReturnType<typeof useClaudeTokens>): string {
  if (s === 'success') return c.status.successBg;
  if (s === 'failure') return c.status.errorBg;
  if (s === 'ran_late') return c.status.warningBg;
  return c.bg.secondary;
}

export function labelForStatus(s: string, t: TFunction): string {
  if (s === 'success') return t('workflows.subviews.status.success');
  if (s === 'failure') return t('workflows.subviews.status.failure');
  if (s === 'ran_late') return t('workflows.subviews.status.ranLate');
  if (s === 'running') return t('workflows.subviews.status.running');
  if (s === 'skipped') return t('workflows.subviews.status.skipped');
  return s;
}

export function formatRunDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

type ActionBtnTone = 'muted' | 'success' | 'danger';

export function ActionBtn({ label, tone, disabled, onClick, icon }: { label: string; tone: ActionBtnTone; disabled?: boolean; onClick: () => void; icon?: 'trash' | 'check' }) {
  const c = useClaudeTokens();
  // Tone -> color triple. Matches target #58/#63 styling: success  = green pill (Save) danger   = red/pink pill (Discard) muted    = neutral pill (Undo)
  const palette = tone === 'success'
    ? { color: c.status.success, bg: c.status.successBg, border: c.status.success + '60', hover: c.status.success + '30' }
    : tone === 'danger'
      ? { color: c.status.error, bg: c.status.errorBg, border: c.status.error + '60', hover: c.status.error + '30' }
      : { color: c.text.secondary, bg: c.bg.secondary, border: c.border.subtle, hover: c.bg.elevated };
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      role="button"
      sx={{
        // Compact pill matching target #58/#63. Smaller padding + smaller glyphs so the buttons stop overshadowing the step body.
        display: 'inline-flex', alignItems: 'center', gap: 0.4,
        fontSize: '0.78rem', fontWeight: 600,
        px: 1, py: 0.35,
        borderRadius: c.radius.full,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: palette.color,
        bgcolor: palette.bg,
        border: `1px solid ${palette.border}`,
        opacity: disabled ? 0.5 : 1,
        '&:hover': { bgcolor: palette.hover },
      }}>
      {icon === 'trash' && (
        <Box component="span" sx={{ display: 'inline-flex', fontSize: 12, lineHeight: 1 }}>{'\u{1F5D1}'}</Box>
      )}
      {icon === 'check' && (
        <Box component="span" sx={{ display: 'inline-flex', fontSize: 12, lineHeight: 1 }}>{'✓'}</Box>
      )}
      {label}
    </Box>
  );
}

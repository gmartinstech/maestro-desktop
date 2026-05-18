import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

export const BODY_FS = '0.88rem';
export const LABEL_FS = '0.82rem';
export const HINT_FS = '0.78rem';
export const INPUT_FS = '0.88rem';

export function FieldRow({ label, children, align }: { label: string; children: React.ReactNode; align?: 'top' | 'center' }) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: align === 'top' ? 'flex-start' : 'center', gap: 1 }}>
      <Typography sx={{ width: 100, flexShrink: 0, fontSize: LABEL_FS, color: c.text.secondary, mt: align === 'top' ? 0.75 : 0, fontWeight: 500 }}>{label}:</Typography>
      {children}
    </Box>
  );
}

export function ActionBtn({ label, tone, disabled, onClick }: { label: string; tone: 'muted' | 'success'; disabled?: boolean; onClick: () => void }) {
  const c = useClaudeTokens();
  const isSuccess = tone === 'success';
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      role="button"
      sx={{
        fontSize: LABEL_FS, fontWeight: 600, px: 1.25, py: 0.5,
        borderRadius: `${c.radius.md}px`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: isSuccess ? c.status.success : c.text.secondary,
        bgcolor: isSuccess ? c.status.successBg : c.bg.secondary,
        border: `1px solid ${isSuccess ? c.status.success + '60' : c.border.subtle}`,
        opacity: disabled ? 0.5 : 1,
        '&:hover': { bgcolor: isSuccess ? c.status.success + '30' : c.bg.elevated },
      }}>
      {label}
    </Box>
  );
}

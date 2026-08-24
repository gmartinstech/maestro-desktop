import React from 'react';
import Box from '@mui/material/Box';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { StepStatus } from './index';

export const CIRCLE_SIZE = 24;

export function StepDisc({ index, status, framed, c }: { index: number; status: StepStatus; framed: boolean; c: ReturnType<typeof useClaudeTokens> }) {
  if (status === 'done') {
    return (
      <Box sx={{
        width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: '50%',
        bgcolor: c.text.muted + '55',
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, position: 'relative', zIndex: 1,
      }}>
        <CheckRounded sx={{ fontSize: 15 }} />
      </Box>
    );
  }
  if (status === 'failed') {
    return (
      <Box sx={{
        width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: '50%',
        bgcolor: c.status.error,
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, position: 'relative', zIndex: 1,
        boxShadow: `0 0 0 3px ${c.status.error}22`,
      }}>
        <CloseRounded sx={{ fontSize: 15 }} />
      </Box>
    );
  }
  if (status === 'active') {
    return (
      <Box sx={{
        width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: '50%',
        border: `2px solid ${c.accent.primary}`,
        bgcolor: c.bg.surface,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, position: 'relative', zIndex: 1,
        animation: 'workflow-step-spin 1.4s linear infinite',
        '@keyframes workflow-step-spin': {
          '0%':   { boxShadow: `0 0 0 0 ${c.accent.primary}55` },
          '50%':  { boxShadow: `0 0 0 4px ${c.accent.primary}00` },
          '100%': { boxShadow: `0 0 0 0 ${c.accent.primary}55` },
        },
      }}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%',
          border: `1.5px solid ${c.accent.primary}`,
          borderTopColor: 'transparent',
          animation: 'workflow-step-dot 0.9s linear infinite',
          '@keyframes workflow-step-dot': {
            '0%':   { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          },
        }} />
      </Box>
    );
  }
  // pending
  void framed;
  void index;
  return (
    <Box sx={{
      width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: '50%',
      border: `1px solid ${c.border.medium}`,
      bgcolor: c.bg.surface,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, position: 'relative', zIndex: 1,
    }} />
  );
}

export function firstWords(s: string, n: number): string {
  const words = (s || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(' ');
  return words.slice(0, n).join(' ') + '...';
}

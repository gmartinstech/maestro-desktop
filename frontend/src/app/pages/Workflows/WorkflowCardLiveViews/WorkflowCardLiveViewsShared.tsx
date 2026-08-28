import React from 'react';
import Box from '@mui/material/Box';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch } from '@/shared/hooks';
import { setCardSidecar } from '@/shared/state/workflowsSlice';
import { DEFAULT_CARD_W, DEFAULT_CARD_H, placeCard, removeCard } from '@/shared/state/dashboardLayoutSlice';
import { setPendingFocusAgentId } from '@/shared/state/tempStateSlice';
import { fetchSession, closeSession, collapseSession } from '@/shared/state/agentsSlice';
import type { AppDispatch } from '@/shared/state/store';

// Unlink the sidecar AND close the chat card it opened. closeSession is what makes removal stick: a bare removeCard gets re-added by reconcileSessions since the run session shares the dashboard.
export function stopViewingSidecar(dispatch: AppDispatch, workflowId: string, sessionId: string | null | undefined) {
  dispatch(setCardSidecar({ workflowId, sessionId: null, kind: null }));
  if (!sessionId) return;
  dispatch(collapseSession(sessionId));
  dispatch(removeCard(sessionId));
  void dispatch(closeSession({ sessionId }));
}

// Helper: open a session next to the workflow card AND mark the card as sidecar-linked so the footer flips to Stop Watching/Viewing and the dashboard draws an arrow chip between the two cards.
export function useOpenSidecar(workflowId: string) {
  const dispatch = useAppDispatch();
  return React.useCallback(async (sessionId: string, kind: 'watching' | 'viewing-completed' | 'viewing-error' | 'testing') => {
    if (!sessionId) return;
    try {
      const { store } = await import('@/shared/state/store');
      if (!store.getState().agents.sessions[sessionId]) {
        try { await dispatch(fetchSession(sessionId)).unwrap(); } catch { /* not fatal */ }
      }
      const wfCardPos = store.getState().dashboardLayout.workflowCards[workflowId];
      if (!store.getState().dashboardLayout.cards[sessionId] && wfCardPos) {
        dispatch(placeCard({
          sessionId,
          x: wfCardPos.x + wfCardPos.width + 60,
          y: wfCardPos.y,
          width: DEFAULT_CARD_W,
          height: DEFAULT_CARD_H,
          expandedSessionIds: store.getState().agents.expandedSessionIds,
        }));
      }
      dispatch(setPendingFocusAgentId(sessionId));
    } catch { /* best-effort */ }
    dispatch(setCardSidecar({ workflowId, sessionId, kind }));
  }, [dispatch, workflowId]);
}

// ---------- Shared bits ----------

export function ProgressBar({ value, color }: { value: number; color: string }) {
  const c = useClaudeTokens();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <Box sx={{ width: '100%', height: 4, borderRadius: 999, bgcolor: c.bg.elevated, overflow: 'hidden' }}>
      <Box sx={{
        width: `${pct * 100}%`, height: '100%', bgcolor: color,
        transition: 'width 0.4s ease',
        boxShadow: `0 0 6px ${color}66`,
      }} />
    </Box>
  );
}

export function PillButton({ label, onClick, icon, tone, filled, disabled }: {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  tone: 'accent' | 'success' | 'danger' | 'muted';
  filled?: boolean;
  disabled?: boolean;
}) {
  const c = useClaudeTokens();
  const colorFor = (t: typeof tone) =>
    t === 'success' ? c.status.success : t === 'danger' ? c.status.error : t === 'accent' ? c.accent.primary : c.text.secondary;
  const color = colorFor(tone);
  const bg = filled ? color : 'transparent';
  const fg = filled ? '#fff' : color;
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      role="button"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        fontSize: '0.86rem', fontWeight: 700,
        px: 1.4, py: 0.55, borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: fg, bgcolor: bg,
        border: filled ? `1px solid ${color}` : `1px solid ${color}55`,
        opacity: disabled ? 0.5 : 1,
        '&:hover': { filter: 'brightness(1.05)', bgcolor: filled ? color : color + '14' },
      }}>
      {icon}
      {label}
    </Box>
  );
}

export function GhostTextBtn({ label, onClick }: { label: string; onClick: () => void }) {
  const c = useClaudeTokens();
  return (
    <Box
      onClick={onClick}
      role="button"
      sx={{
        fontSize: '0.86rem', fontWeight: 500, color: c.text.secondary,
        cursor: 'pointer', px: 0.75, py: 0.5,
        '&:hover': { color: c.text.primary },
      }}>
      {label}
    </Box>
  );
}

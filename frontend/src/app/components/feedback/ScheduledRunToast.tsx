import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Fade from '@mui/material/Fade';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { clearRunStartSignal, openWorkflowCard } from '@/shared/state/workflowsSlice';
import { addWorkflowCard } from '@/shared/state/dashboardLayoutSlice';

const VISIBLE_MS = 6000;

// Quiet bottom-center toast that confirms an unattended scheduled run kicked
// off, so the user isn't blind to it the way the completion notification used
// to be the only signal. Click to jump straight to the live run.
export default function ScheduledRunToast() {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const signal = useAppSelector((s) => s.workflows.runStartSignal);
  const [show, setShow] = useState(false);
  // Keep the last payload so the exit fade renders the same content instead of
  // blanking mid-animation once the signal is cleared.
  const snapshot = useRef<typeof signal>(null);
  if (signal) snapshot.current = signal;

  useEffect(() => {
    if (!signal) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [signal?.nonce]);

  const display = snapshot.current;
  if (!display) return null;

  const onOpen = () => {
    dispatch(addWorkflowCard({ workflowId: display.workflowId }));
    dispatch(openWorkflowCard({ workflowId: display.workflowId, view: 'running', runId: display.runId }));
    setShow(false);
  };

  return (
    <Fade in={show} timeout={{ enter: 200, exit: 220 }} unmountOnExit onExited={() => dispatch(clearRunStartSignal())}>
      <Box
        onClick={onOpen}
        role="button"
        sx={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1500,
          display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: c.bg.surface, border: `1px solid ${c.border.medium}`,
          boxShadow: c.shadow.md, borderRadius: `${c.radius.lg}px`,
          px: 1.75, py: 1,
          cursor: 'pointer', maxWidth: 360,
          '&:hover': { borderColor: c.accent.primary },
        }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', width: 18, height: 18, color: c.accent.primary, animation: 'srtPulse 1.4s ease-in-out infinite' }}>
          <BoltRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ fontSize: '0.85rem', color: c.text.primary, lineHeight: 1.4 }}>
          <b>{display.title}</b> started running
        </Box>
        <Box sx={{ fontSize: '0.78rem', color: c.accent.primary, fontWeight: 700, ml: 0.5 }}>Open</Box>
        <style>{'@keyframes srtPulse{0%,100%{opacity:1}50%{opacity:0.4}}'}</style>
      </Box>
    </Fade>
  );
}

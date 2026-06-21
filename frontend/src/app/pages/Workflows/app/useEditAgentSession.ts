import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAuthToken } from '@/shared/config';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { fetchSession } from '@/shared/state/agentsSlice';
import { ensureEditAgentSession } from './api';

function tok(): string { try { return getAuthToken(); } catch { return ''; } }

// Boots (or reattaches) the sticky edit-agent session for a workflow and seeds
// the opener so the agent greets in the right mode. Returns the session id once
// ready. 'build' for a fresh workflow with no steps, 'modify' for an existing one.
export function useEditAgentSession(workflowId: string, seedMode: 'build' | 'modify'): string | null {
  const dispatch = useAppDispatch();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const didInit = useRef(false);
  const seeded = useRef(false);

  useEffect(() => {
    didInit.current = false;
    seeded.current = false;
    setSessionId(null);
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId || didInit.current) return;
    didInit.current = true;
    let alive = true;
    (async () => {
      const sid = await ensureEditAgentSession(workflowId);
      if (!sid || !alive) return;
      try { await dispatch(fetchSession(sid)).unwrap(); } catch { /* may hydrate later */ }
      if (alive) setSessionId(sid);
    })();
    return () => { alive = false; };
  }, [workflowId, dispatch]);

  const session = useAppSelector((s) => (sessionId ? s.agents.sessions[sessionId] : undefined));
  useEffect(() => {
    if (!sessionId || !session || seeded.current) return;
    if ((session.messages || []).length > 0) { seeded.current = true; return; }
    seeded.current = true;
    const seed = seedMode === 'build'
      ? 'Greet me briefly, then ask: "What should this workflow do?"'
      : 'Greet me briefly, then ask: "How would you like to modify this workflow?"';
    (async () => {
      try {
        await fetch(`${API_BASE}/agents/sessions/${encodeURIComponent(sessionId)}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(tok() ? { Authorization: `Bearer ${tok()}` } : {}) },
          body: JSON.stringify({ prompt: seed, hidden: true }),
        });
      } catch { /* best-effort */ }
    })();
  }, [sessionId, session, seedMode]);

  return sessionId;
}

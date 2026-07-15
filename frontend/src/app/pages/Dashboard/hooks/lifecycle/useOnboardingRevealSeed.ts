import { useEffect, useRef, type RefObject } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { addNote, placeCard, DEFAULT_CARD_W, DEFAULT_CARD_H } from '@/shared/state/dashboardLayoutSlice';
import { createDraftSession, launchAndSendFirstMessage, type AgentConfig } from '@/shared/state/agentsSlice';
import { hasModelConnected } from '@/app/components/Onboarding/steps/skipPredicates';
import { clearReveal } from '@/shared/state/onboardingV3Slice';

interface Args {
  isActive: boolean;
  canvasEmpty: boolean;
  dashboardId: string;
  expandedSessionIds: string[];
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasStateRef: RefObject<{ panX: number; panY: number; zoom: number }>;
  createWelcomeDraft: () => void;
}

// The reveal: onboarding v3 finished behind the curtain, so dress the canvas BEFORE the overlay's exit fade lands. Welcome chat (personalized greeting + chips) at center, the read-only audit RUNNING as a real agent on the left (only on a real connected sub; the fragile free-trial pool never carries the demo), and a "while you were setting up" note on the right. Nothing seeded can mutate the user's files.
export function useOnboardingRevealSeed({ isActive, canvasEmpty, dashboardId, expandedSessionIds, viewportRef, canvasStateRef, createWelcomeDraft }: Args): void {
  const dispatch = useAppDispatch();
  const revealPending = useAppSelector((s) => s.onboardingV3.revealPending);
  const starters = useAppSelector((s) => s.onboardingV3.starters);
  const scanSummary = useAppSelector((s) => s.onboardingV3.scanSummary);
  const autoPrompt = useAppSelector((s) => s.onboardingV3.autoPrompt);
  const settingsLoaded = useAppSelector((s) => s.settings.loaded);
  const model = useAppSelector((s) => s.settings.data.default_model);
  const connected = useAppSelector((s) => hasModelConnected(s));
  const seededRef = useRef(false);

  useEffect(() => {
    if (!revealPending || seededRef.current || !isActive || !canvasEmpty || !settingsLoaded) return;
    seededRef.current = true;
    try {
      const vp = viewportRef.current;
      const cs = canvasStateRef.current;
      const autoRun = !!autoPrompt && connected;
      if (vp && cs) {
        const vr = vp.getBoundingClientRect();
        const cx = (vr.width / 2 - cs.panX) / cs.zoom;
        const cy = (vr.height / 2 - cs.panY) / cs.zoom;
        const lines: string[] = ['While you were setting up, I got some ideas ready.'];
        if (scanSummary) lines.push(`Spotted on this Mac: ${scanSummary}.`);
        if (autoRun && starters.length > 0) lines.push(`Already running: ${starters[0].title}.`);
        if (starters.length > 0) lines.push(`Ready to run:\n${starters.slice(autoRun ? 1 : 0).map((s) => `- ${s.title}`).join('\n')}`);
        dispatch(addNote({ x: cx + DEFAULT_CARD_W / 2 + 48, y: cy - 140, color: 'yellow', content: lines.join('\n\n') }));
        if (autoRun) {
          const config: AgentConfig = { name: starters[0]?.title || 'First look', model, mode: 'agent', dashboard_id: dashboardId };
          const draftId = dispatch(createDraftSession({ mode: 'agent', model, dashboardId, setActive: false })).payload.draftId;
          dispatch(placeCard({ sessionId: draftId, x: cx - DEFAULT_CARD_W * 1.5 - 48, y: cy - DEFAULT_CARD_H / 2, width: DEFAULT_CARD_W, height: DEFAULT_CARD_H, expandedSessionIds, exact: true }));
          void dispatch(launchAndSendFirstMessage({ draftId, config, prompt: autoPrompt, mode: 'agent', model }));
        }
      }
      createWelcomeDraft();
    } finally {
      dispatch(clearReveal());
    }
  }, [revealPending, isActive, canvasEmpty, settingsLoaded, starters, scanSummary, autoPrompt, connected, model, dashboardId, expandedSessionIds, viewportRef, canvasStateRef, createWelcomeDraft, dispatch]);
}

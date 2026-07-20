import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { store } from '@/shared/state/store';
import {
  placeCard, addWorkflowCard, setWorkflowCardPosition, setViewCardPosition,
  DEFAULT_CARD_W, DEFAULT_CARD_H, EXPANDED_CARD_MIN_H,
} from '@/shared/state/dashboardLayoutSlice';
import { clearReveal, setRevealAnchor } from '@/shared/state/onboardingV3Slice';

interface Args {
  isActive: boolean;
  dashboardId: string;
  expandedSessionIds: string[];
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasStateRef: RefObject<{ panX: number; panY: number; zoom: number }>;
  createWelcomeDraft: () => void;
  fitToCards: (rects: Array<{ x: number; y: number; width: number; height: number }>, maxZoom?: number, animate?: boolean, minZoom?: number, centered?: boolean) => void;
}

const GAP = 48;

/** Where the reveal's app view card is born: right of the welcome chat, top-aligned. The "here's what I did" legend is the fixed RevealHero panel, not a canvas note, so the app sits right next to the chat. */
export function revealAppSpot(anchor: { cx: number; cy: number }): { x: number; y: number } {
  return { x: anchor.cx + DEFAULT_CARD_W / 2 + GAP, y: anchor.cy - EXPANDED_CARD_MIN_H / 2 };
}

// The reveal: onboarding v3 finished behind the curtain and the prepped work (a personal dashboard app, a live web-research dig, a read-only file tidy-up, and one recurring task) has been running since mid-flow. Compose one tight readable cluster: welcome chat center, jobs stacked left, the plain-English note right; the app view card is born at the arc end (via revealAnchor + the lifecycle auto-add) and the camera glides to it when it arrives. The keep/discard toast owns the jobs' fate afterward.
export function useOnboardingRevealSeed({ isActive, dashboardId, expandedSessionIds, viewportRef, canvasStateRef, createWelcomeDraft, fitToCards }: Args): void {
  const dispatch = useAppDispatch();
  const revealPending = useAppSelector((s) => s.onboardingV3.revealPending);
  const prepped = useAppSelector((s) => s.onboardingV3.prepped);
  const settingsLoaded = useAppSelector((s) => s.settings.loaded);
  const seededRef = useRef(false);
  // Jobs launch async at prep-resolve, so some land in `prepped` a beat AFTER the curtain lifts. The
  // anchor + placed-set let us keep dropping those cards in the same left stack instead of losing them.
  const anchorRef = useRef<{ cx: number; cy: number } | null>(null);
  const placedRef = useRef<Set<string>>(new Set());

  const placeJobs = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    prepped.forEach((job) => {
      const key = job.workflowId || job.sessionId;
      if (placedRef.current.has(key)) return;
      const i = placedRef.current.size;
      // Left column, top-aligned with the expanded welcome chat, tight vertical rhythm.
      const x = a.cx - DEFAULT_CARD_W / 2 - GAP - DEFAULT_CARD_W;
      const y = a.cy - EXPANDED_CARD_MIN_H / 2 + i * (DEFAULT_CARD_H + 24);
      if (job.kind === 'schedule' && job.workflowId) {
        // The scheduled task is a workflow, not an agent session: place its workflow card in the same stack.
        dispatch(addWorkflowCard({ workflowId: job.workflowId, expandedSessionIds }));
        dispatch(setWorkflowCardPosition({ workflowId: job.workflowId, x, y }));
      } else {
        dispatch(placeCard({ sessionId: job.sessionId, x, y, width: DEFAULT_CARD_W, height: DEFAULT_CARD_H, expandedSessionIds, exact: true }));
      }
      placedRef.current.add(key);
    });
  }, [prepped, dispatch, expandedSessionIds]);

  // One-time: fix the anchor, seed the welcome chat + the "head start" note, place jobs present so far,
  // then frame the camera on the whole cluster so the curtain lifts onto a composed, readable scene.
  useEffect(() => {
    if (!revealPending || seededRef.current || !isActive || !settingsLoaded) return;
    seededRef.current = true;
    try {
      const vp = viewportRef.current;
      const cs = canvasStateRef.current;
      if (vp && cs) {
        const vr = vp.getBoundingClientRect();
        const cx = (vr.width / 2 - cs.panX) / cs.zoom;
        const cy = (vr.height / 2 - cs.panY) / cs.zoom;
        anchorRef.current = { cx, cy };
        dispatch(setRevealAnchor({ cx, cy }));
        const app = prepped.find((j) => j.kind === 'app');
        // The "here's what I did" legend is the fixed RevealHero panel (top-center, unmissable, live
        // status), not a canvas note, so there is no wall-of-text sticky to miss here anymore.
        placeJobs();
        // The app agent often creates its output BEFORE the curtain lifts (it gets a head start at
        // connect), so its view card was auto-added with no anchor to stage against. Move it to the
        // arc-end spot now; the birth-position path in useDashboardLifecycle covers late arrivals.
        if (app?.sessionId) {
          const now = store.getState();
          const out = Object.values(now.outputs.items).find((o) => o.session_id === app.sessionId);
          if (out && now.dashboardLayout.viewCards[out.id]) {
            const spot = revealAppSpot({ cx, cy });
            dispatch(setViewCardPosition({ outputId: out.id, x: spot.x, y: spot.y }));
          }
        }
        createWelcomeDraft();
        // Frame the whole cluster (jobs column + chat + note) so the reveal is readable, not scattered.
        const left = cx - DEFAULT_CARD_W / 2 - GAP - DEFAULT_CARD_W;
        const top = cy - EXPANDED_CARD_MIN_H / 2;
        fitToCards(
          [{ x: left, y: top, width: (DEFAULT_CARD_W * 2) + (GAP * 2), height: Math.max(EXPANDED_CARD_MIN_H, DEFAULT_CARD_H * 3 + 48) }],
          0.9,
          true,
        );
      } else {
        createWelcomeDraft();
      }
    } finally {
      dispatch(clearReveal());
    }
  }, [revealPending, isActive, settingsLoaded, prepped, dashboardId, expandedSessionIds, viewportRef, canvasStateRef, createWelcomeDraft, fitToCards, dispatch, placeJobs]);

  // Jobs that launched after the curtain lifted: drop their cards in as they arrive.
  useEffect(() => {
    if (seededRef.current) placeJobs();
  }, [prepped, placeJobs]);
}

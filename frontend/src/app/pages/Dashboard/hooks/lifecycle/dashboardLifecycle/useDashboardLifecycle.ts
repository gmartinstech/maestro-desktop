import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { report } from '@/shared/serviceClient';
import { store } from '@/shared/state/store';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  fetchSessions,
  fetchHistory,
  setExpandedSessionIds,
  type AgentSession,
} from '@/shared/state/agentsSlice';
import {
  fetchLayout,
  reconcileSessions,
  addBrowserCard,
  addViewCard,
  resetLayout,
  removeViewCard,
  type ViewCardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import { fetchOutputs, type Output } from '@/shared/state/outputsSlice';
import { generateDashboardName } from '@/shared/state/dashboardsSlice';
import { fetchWorkflows, fetchAllRuns, fetchActiveRuns } from '@/shared/state/workflowsSlice';
import { fetchMissedRuns } from '@/shared/state/missedRunsSlice';
import { fetchProviderHealth } from '@/shared/state/subscriptionsSlice';
import { dashboardWs } from '@/shared/ws/WebSocketManager';
import { initBrowserCommandHandler } from '@/shared/browserCommandHandler';
import { getKeepAliveBrowserIds } from '@/shared/browserFocus';
import { clearPendingBrowserUrl } from '@/shared/state/tempStateSlice';
import { API_BASE } from '@/shared/config';
import type { CanvasActions } from '../../interaction/pointer/useCanvasControls';
import { useDashboardFocusEffects } from './useDashboardFocusEffects';

// Module-level so the missed-runs review pops exactly once per app launch, not again on every dashboard switch.
let missedRunsCheckedThisSession = false;

interface UseDashboardLifecycleArgs {
  isActive: boolean;
  dashboardId: string;
  layoutInitialized: boolean;
  sessions: Record<string, AgentSession>;
  expandedSessionIds: string[];
  persistedExpandedSessionIds: string[];
  viewCards: Record<string, ViewCardPosition>;
  outputs: Record<string, Output>;
  outputsLoaded: boolean;
  canvasActions: CanvasActions;
  handleHighlightCard: (cardId: string) => void;
  hasFittedRef: MutableRefObject<boolean>;
  restoredExpandedRef: MutableRefObject<boolean>;
}

export function useDashboardLifecycle({
  isActive,
  dashboardId,
  layoutInitialized,
  sessions,
  expandedSessionIds,
  persistedExpandedSessionIds,
  viewCards,
  outputs,
  outputsLoaded,
  canvasActions,
  handleHighlightCard,
  hasFittedRef,
  restoredExpandedRef,
}: UseDashboardLifecycleArgs) {
  const dispatch = useAppDispatch();
  // True once THIS dashboard open has refetched outputs. The orphan-prune below keys off this, not the sticky global outputsLoaded, so it never wipes a just-imported app card by judging it against a stale (previous-dashboard) apps list before the fresh fetch lands.
  const [outputsRefetched, setOutputsRefetched] = useState(false);
  const pendingBrowserUrl = useAppSelector((state) => state.tempState.pendingBrowserUrl);
  const { pendingFocusAgentId } = useDashboardFocusEffects({
    isActive,
    layoutInitialized,
    canvasActions,
    handleHighlightCard,
    hasFittedRef,
  });

  // Once per app launch: if scheduled fires elapsed while we were closed, fetch them. The slice flips its toast flag on fulfilled, so a bottom-left nudge shows instead of a card popping unrequested; the user opens the card from it.
  useEffect(() => {
    if (!isActive || missedRunsCheckedThisSession) return;
    missedRunsCheckedThisSession = true;
    dispatch(fetchMissedRuns());
    // Login-health check rides the same once-per-launch gate; delayed so the lazy router has time to boot, with ONE retry when the probe reports it wasn't up yet.
    const t = setTimeout(async () => {
      try {
        const res = await dispatch(fetchProviderHealth()).unwrap();
        if (res.skipped) setTimeout(() => { dispatch(fetchProviderHealth()); }, 45_000);
      } catch { /* probe is best-effort; silence on failure */ }
    }, 12_000);
    return () => clearTimeout(t);
  }, [isActive, dispatch]);

  // Track dashboard engagement time
  useEffect(() => {
    if (!dashboardId) return;
    const startTime = Date.now();
    report('dashboard', 'opened', { dashboard_id: dashboardId });
    return () => {
      report('dashboard', 'closed', {
        dashboard_id: dashboardId,
        time_spent_seconds: Math.round((Date.now() - startTime) / 1000),
      });
    };
  }, [dashboardId]);

  // Tell the backend which dashboard is on screen, so a scheduled workflow run spawns its browser card on the dashboard the user can actually see. send queues until the socket opens, so firing before connect is fine.
  useEffect(() => {
    if (!dashboardId) return;
    dashboardWs.send('dashboard:active', { dashboard_id: dashboardId });
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardId) return;
    hasFittedRef.current = false;
    restoredExpandedRef.current = false;
    setOutputsRefetched(false);
    dispatch(resetLayout({ keepBrowserIds: getKeepAliveBrowserIds() }));
    // CRITICAL path: these populate the cards the user expects to see on first paint. Don't defer.
    dispatch(fetchSessions({ dashboardId }));
    dispatch(fetchLayout({ dashboardId }));
    const cleanupBrowserHandler = initBrowserCommandHandler();
    // Global broadcasts (spawned browser cards) skip the replay log, so a socket gap loses them; a reconnect refetch is the only way they return.
    const unsubReconnect = dashboardWs.on('dashboard:reconnected', () => {
      // A socket gap drops the backend's active-dashboard pointer; re-assert it so scheduled-run browser cards still target this dashboard after a reconnect.
      dashboardWs.send('dashboard:active', { dashboard_id: dashboardId });
      dispatch(fetchSessions({ dashboardId }));
      dispatch(fetchLayout({ dashboardId, isReconnect: true }));
      // workflow:run/updated/deleted are global broadcasts that skip the replay log, so a socket gap drops them: refetch to heal stale "running" cards, ghost workflows, and missed run history on reconnect.
      dispatch(fetchWorkflows(dashboardId));
      dispatch(fetchAllRuns(200));
      dispatch(fetchActiveRuns());
    });
    // DEFERRABLE: history list (for the search palette) and outputs (for the apps panel) aren't on the first-paint path. Same for the dashboard WS connection (it carries cross-session events; opens ~100ms later costs nothing). Pushing these into the post-paint window measurably improves LCP because the initial render pipeline isn't competing with their thunks/network setup.
    const loadDeferred = () => {
      dispatch(fetchHistory({ dashboardId }));
      // Mark outputs fresh only after a SUCCESSFUL fetch, so the prune below judges view cards against this dashboard's real apps, not a stale list.
      dispatch(fetchOutputs()).then((res) => {
        if (fetchOutputs.fulfilled.match(res)) setOutputsRefetched(true);
      });
      dispatch(fetchWorkflows(dashboardId));
      dashboardWs.connect();
    };
    const idleHandle = (typeof window !== 'undefined' && (window as any).requestIdleCallback)
      ? (window as any).requestIdleCallback(loadDeferred, { timeout: 2000 })
      : window.setTimeout(loadDeferred, 200);

    // Pre-warm Anthropic's prompt cache for sessions on this dashboard ~250ms after mount (debounced; AbortController cancels on dashboard switch). Fires a max_tokens=1 ping per session so the user's first real message hits a warm cache instead of paying cold-start TTFT. Cheap (~$0.0001/session) and non-blocking. Skips for non-Anthropic sessions server-side.
    const warmAbort = new AbortController();
    const warmTimer = setTimeout(async () => {
      try {
        const sessionsState = store.getState().agents.sessions;
        const dashSessions = Object.values(sessionsState).filter(
          (s) => s.dashboard_id === dashboardId &&
                 s.status !== 'draft' &&
                 s.mode !== 'browser-agent' &&
                 s.mode !== 'sub-agent' &&
                 s.mode !== 'invoked-agent',
        );
        for (const s of dashSessions) {
          if (warmAbort.signal.aborted) break;
          // Fire-and-forget, the endpoint always 200s and the side effect is invisible cache population.
          fetch(`${API_BASE}/agents/sessions/${s.id}/warm-cache`, {
            method: 'POST',
            signal: warmAbort.signal,
          }).catch(() => {});
        }
      } catch {
        /* best-effort */
      }
    }, 250);

    return () => {
      clearTimeout(warmTimer);
      warmAbort.abort();
      cleanupBrowserHandler();
      unsubReconnect();
      dashboardWs.disconnect();
      // Cancel any not-yet-fired idle work; the cleanup handler can't run partially if the dashboard switches before idle fired.
      if (typeof window !== 'undefined') {
        const cancelIdle = (window as any).cancelIdleCallback;
        if (cancelIdle && typeof idleHandle === 'number') cancelIdle(idleHandle);
        else if (typeof idleHandle === 'number') clearTimeout(idleHandle);
      }
    };
  }, [dispatch, dashboardId]);

  useEffect(() => {
    if (!dashboardId) return;
    (window as any).__maestro_last_dashboard_id = dashboardId;
  }, [dashboardId]);

  useEffect(() => {
    if (!pendingBrowserUrl || !layoutInitialized) return;
    dispatch(addBrowserCard({ url: pendingBrowserUrl, expandedSessionIds }));
    dispatch(clearPendingBrowserUrl());
  }, [pendingBrowserUrl, layoutInitialized, dispatch, expandedSessionIds]);

  useEffect(() => {
    if (!isActive) return;  // Don't auto-fit while dashboard is hidden
    if (!layoutInitialized || hasFittedRef.current) return;
    if (pendingFocusAgentId) return;
    hasFittedRef.current = true;
    const timer = setTimeout(() => canvasActions.fitToView(), 150);
    return () => clearTimeout(timer);
  }, [isActive, layoutInitialized, canvasActions, pendingFocusAgentId]);

  useEffect(() => {
    if (!layoutInitialized || restoredExpandedRef.current) return;
    restoredExpandedRef.current = true;
    dispatch(setExpandedSessionIds(persistedExpandedSessionIds));
  }, [layoutInitialized, persistedExpandedSessionIds, dispatch]);

  const prevSessionIdsRef = useRef<string>('');

  useEffect(() => {
    if (!layoutInitialized) return;
    const dashboardSessionIds = Object.values(sessions)
      .filter((s) => s.dashboard_id === dashboardId && !s.workflow_run_id && !s.workflow_edit_id && s.mode !== 'browser-agent' && s.mode !== 'invoked-agent' && s.mode !== 'sub-agent')
      .map((s) => s.id);
    const liveIds = dashboardSessionIds.sort().join(',');
    if (liveIds === prevSessionIdsRef.current) return;
    prevSessionIdsRef.current = liveIds;
    dispatch(reconcileSessions({ sessionIds: dashboardSessionIds, expandedSessionIds }));
  }, [sessions, layoutInitialized, dispatch, dashboardId, expandedSessionIds]);

  // Prune orphan view cards whose underlying output was deleted (e.g. via the Views page). Without this, the layout entry persists in the minimap and contentBounds even though DashboardViewCard renders nothing. Gated on outputsRefetched (THIS open's fresh fetch), NOT the sticky global outputsLoaded: on a freshly-imported dashboard the global flag is already true from a prior dashboard, so the old gate pruned the just-imported app card against a stale apps list and the debounced save persisted the wipe.
  useEffect(() => {
    if (!layoutInitialized || !outputsRefetched) return;
    for (const outputId of Object.keys(viewCards)) {
      if (!outputs[outputId]) dispatch(removeViewCard(outputId));
    }
  }, [layoutInitialized, outputsRefetched, viewCards, outputs, dispatch]);

  // On first load after outputs settle, snapshot every existing Output id as "already accounted for." Any output that ARRIVES later (typically the agent:output_upserted WS broadcast the backend fires the instant a view-builder session is seeded, at session start) whose session_id points at a view-builder chat on this dashboard gets a view card dropped on the canvas right away. Per-mount tracked so a manual close after auto-open stays closed. Prior approach keyed off a pending-set populated inside launchAndSendFirstMessage.then(): the WS upsert won the race and the effect saw an empty set, so the card didn't pop until the session-end meta-sync re-broadcast.
  const autoOpenedOutputsRef = useRef<Set<string>>(new Set());
  const outputsSnapshottedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!layoutInitialized || !outputsLoaded) return;
    if (!outputsSnapshottedRef.current) {
      for (const oid of Object.keys(outputs)) autoOpenedOutputsRef.current.add(oid);
      outputsSnapshottedRef.current = true;
      return;
    }
    for (const output of Object.values(outputs)) {
      if (autoOpenedOutputsRef.current.has(output.id)) continue;
      const sid = output.session_id;
      if (!sid) continue;
      // Any mode: apps are born from normal agents via CreateApp now, not just view-builder sessions.
      const sess = sessions[sid];
      if (!sess) continue;
      if (sess.dashboard_id !== dashboardId) continue;
      autoOpenedOutputsRef.current.add(output.id);
      if (viewCards[output.id]) continue;
      dispatch(addViewCard({ outputId: output.id, expandedSessionIds, parentSessionId: sid }));
      const outputId = output.id;
      setTimeout(() => {
        const vc = store.getState().dashboardLayout.viewCards[outputId];
        if (!vc) return;
        const rects = [{ x: vc.x, y: vc.y, width: vc.width, height: vc.height }];
        const ac = store.getState().dashboardLayout.cards[sid];
        if (ac) rects.push({ x: ac.x, y: ac.y, width: ac.width, height: ac.height });
        canvasActions.fitToCards(rects, 1.15, true);
        handleHighlightCard(outputId);
      }, 200);
    }
  }, [layoutInitialized, outputsLoaded, outputs, sessions, viewCards, dashboardId, expandedSessionIds, dispatch, canvasActions, handleHighlightCard]);

  const namedOnFirstMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboardId || !layoutInitialized) return;
    if (namedOnFirstMessageRef.current === dashboardId) return;
    const dash = store.getState().dashboards.items[dashboardId];
    if (!dash) return;
    if (!dash.auto_named && dash.name !== 'Untitled Dashboard') return;
    const hasUserMessage = Object.values(sessions).some(
      (s) => s.dashboard_id === dashboardId && s.messages?.some((m) => m.role === 'user'),
    );
    if (!hasUserMessage) return;
    namedOnFirstMessageRef.current = dashboardId;
    dispatch(generateDashboardName(dashboardId));
  }, [sessions, dashboardId, layoutInitialized, dispatch]);
}

import { useEffect, type MutableRefObject } from 'react';
import { store } from '@/shared/state/store';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  clearPendingFocusBrowserId,
  clearPendingFocusViewCardId,
  clearPendingFocusWorkflowId,
  clearPendingFocusWorkflowsHub,
} from '@/shared/state/dashboardLayoutSlice';
import { clearPendingFocusAgentId } from '@/shared/state/tempStateSlice';
import type { CanvasActions } from '../../interaction/pointer/useCanvasControls';

interface UseDashboardFocusEffectsArgs {
  isActive: boolean;
  layoutInitialized: boolean;
  canvasActions: CanvasActions;
  handleHighlightCard: (cardId: string) => void;
  hasFittedRef: MutableRefObject<boolean>;
}

// One effect per "a card was just created/opened elsewhere" signal: pan/zoom to it, briefly highlight it, then clear the signal. Kept together since every case follows the same pending-id -> clear -> fit + highlight choreography, just against a different layout slice.
export function useDashboardFocusEffects({
  isActive,
  layoutInitialized,
  canvasActions,
  handleHighlightCard,
  hasFittedRef,
}: UseDashboardFocusEffectsArgs) {
  const dispatch = useAppDispatch();
  const pendingFocusAgentId = useAppSelector((state) => state.tempState.pendingFocusAgentId);
  const pendingFocusBrowserId = useAppSelector((state) => state.dashboardLayout.pendingFocusBrowserId);
  const pendingFocusViewCardId = useAppSelector((state) => state.dashboardLayout.pendingFocusViewCardId);
  const pendingFocusWorkflowId = useAppSelector((state) => state.dashboardLayout.pendingFocusWorkflowId);
  const pendingFocusWorkflowsHub = useAppSelector((state) => state.dashboardLayout.pendingFocusWorkflowsHub);

  useEffect(() => {
    if (!isActive) return;  // Defer focus animation until dashboard is visible
    if (!pendingFocusAgentId || !layoutInitialized) return;
    const agentId = pendingFocusAgentId;
    dispatch(clearPendingFocusAgentId());
    hasFittedRef.current = true;
    setTimeout(() => {
      const card = store.getState().dashboardLayout.cards[agentId];
      if (card) {
        canvasActions.fitToCards([{ x: card.x, y: card.y, width: card.width, height: card.height }], 1.15, true);
        handleHighlightCard(agentId);
      }
    }, 350);
  }, [isActive, pendingFocusAgentId, layoutInitialized, dispatch, canvasActions, handleHighlightCard]);

  // Auto-focus a newly created browser card. The reducer that handles addBrowserCard sets pendingFocusBrowserId to the new card's id; this effect picks it up, pans/zooms the canvas to center on it, briefly highlights it, then clears the signal. Mirrors the pendingFocusAgentId pattern above so link clicks (intercepted in AppShell) get the same auto-focus behavior as the "+ Browser" toolbar button. Uses zoom=0.8 (the same value handleCardClick uses for browser cards at line ~344) instead of letting fitToCards auto-derive a zoom from padding. Browser cards are large (1280x800), so the auto-derived zoom would land around ~58% which feels too far back; 0.8 matches the "click on a browser to focus" experience the user expects.
  useEffect(() => {
    if (!isActive) return;
    if (!pendingFocusBrowserId || !layoutInitialized) return;
    const browserId = pendingFocusBrowserId;
    dispatch(clearPendingFocusBrowserId());
    hasFittedRef.current = true;
    setTimeout(() => {
      const card = store.getState().dashboardLayout.browserCards[browserId];
      if (card) {
        canvasActions.fitToCards(
          [{ x: card.x, y: card.y, width: card.width, height: card.height }],
          1.15,
          true,
          0.8,
          true,
        );
        handleHighlightCard(browserId);
      }
    }, 200);
  }, [isActive, pendingFocusBrowserId, layoutInitialized, dispatch, canvasActions, handleHighlightCard]);

  // Auto-focus a view card opened from OUTSIDE the canvas (sidebar app click, toolbar picker). addViewCard sets pendingFocusViewCardId; fit + highlight it, then clear. Mirrors the browser path above so reopening a closed app lands you looking right at it.
  useEffect(() => {
    if (!isActive) return;
    if (!pendingFocusViewCardId || !layoutInitialized) return;
    const cardKey = pendingFocusViewCardId;
    dispatch(clearPendingFocusViewCardId());
    hasFittedRef.current = true;
    setTimeout(() => {
      const card = store.getState().dashboardLayout.viewCards[cardKey];
      if (card) {
        canvasActions.fitToCards([{ x: card.x, y: card.y, width: card.width, height: card.height }], 1.15, true);
        handleHighlightCard(cardKey);
      }
    }, 200);
  }, [isActive, pendingFocusViewCardId, layoutInitialized, dispatch, canvasActions, handleHighlightCard]);

  // Same pan/highlight choreography for newly-spawned workflow cards.
  useEffect(() => {
    if (!isActive) return;
    if (!pendingFocusWorkflowId || !layoutInitialized) return;
    const workflowId = pendingFocusWorkflowId;
    dispatch(clearPendingFocusWorkflowId());
    setTimeout(() => {
      const card = store.getState().dashboardLayout.workflowCards[workflowId];
      if (card) {
        canvasActions.fitToCards(
          [{ x: card.x, y: card.y, width: card.width, height: card.height }],
          1.15,
          true,
        );
        handleHighlightCard(workflowId);
      }
    }, 200);
  }, [isActive, pendingFocusWorkflowId, layoutInitialized, dispatch, canvasActions, handleHighlightCard]);

  // Pan/zoom to Workflows Hub on Expand; chained rAFs ensure fit runs after the hub div lands at its new coords.
  useEffect(() => {
    if (!isActive) return;
    if (!pendingFocusWorkflowsHub || !layoutInitialized) return;
    dispatch(clearPendingFocusWorkflowsHub());
    const fit = () => {
      const hub = store.getState().dashboardLayout.workflowsHub;
      if (!hub) return;
      canvasActions.fitToCards(
        [{ x: hub.x, y: hub.y, width: hub.width, height: hub.height }],
        1.1,
        true,
      );
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    const fallback = setTimeout(fit, 300);
    return () => clearTimeout(fallback);
  }, [isActive, pendingFocusWorkflowsHub, layoutInitialized, dispatch, canvasActions]);

  return { pendingFocusAgentId };
}

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type {
  CardPosition,
  ViewCardPosition,
  BrowserCardPosition,
  WorkflowCardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import type { CanvasActions } from '../../interaction/pointer/useCanvasControls';
import type { CardType, useDashboardSelection } from '../useDashboardSelection';
import { useArrowNav } from '../../interaction/pointer/useArrowNav';
import { useAgentSpawn } from '../../lifecycle/useAgentSpawn';
import { useDashboardCardActions } from '../../lifecycle/useDashboardCardActions';
import { useSiblingRestack } from '../../lifecycle/useSiblingRestack';

type Selection = ReturnType<typeof useDashboardSelection>;
type SpawnOrigin = { x: number; y: number; type?: 'branch' };
type GlowingCard = { sourceId: string };

interface UseDashboardActionHandlersArgs {
  cards: Record<string, CardPosition>;
  viewCards: Record<string, ViewCardPosition>;
  browserCards: Record<string, BrowserCardPosition>;
  workflowCards: Record<string, WorkflowCardPosition>;
  expandedSessionIds: string[];
  dashboardId: string;
  expandNewChats: boolean;
  browserHomepage: string;
  pendingFocusNoteId: string | null;
  selection: Selection;
  canvasActions: CanvasActions;
  zoom: number;
  isActive: boolean;
  focusedCardId: string | null;
  setFocusedCardId: Dispatch<SetStateAction<string | null>>;
  getCardRect: (id: string, type: CardType) => { x: number; y: number; width: number; height: number } | undefined;
  viewportRef: RefObject<HTMLDivElement | null>;
  toolbarRef: RefObject<HTMLDivElement | null>;
  canvasStateRef: RefObject<{ panX: number; panY: number; zoom: number }>;
  spawnOriginsRef: RefObject<Record<string, SpawnOrigin>>;
  handleHighlightCard: (cardId: string) => void;
  setToolbarOpen: Dispatch<SetStateAction<boolean>>;
  setAutoFocusSessionId: Dispatch<SetStateAction<string | null>>;
  setPendingSelectSessionId: Dispatch<SetStateAction<string | null>>;
  welcomeEligible?: boolean;
  onWelcomeNewAgent?: () => void;
  glowingAgentCards: Record<string, GlowingCard>;
  glowingBrowserCards: Record<string, GlowingCard>;
  measuredHeightsRef: RefObject<Record<string, number>>;
  measuredHeightsTick: number;
}

// Bundles the leaf "user action" hooks that useDashboardController only wires up and forwards to its return value: arrow-key nav, spawning/branching agents, the toolbar card-creation actions, and sibling-card restack. None of these feed into one another, so grouping their invocation here keeps the composition root focused on state that actually threads between hooks.
export function useDashboardActionHandlers({
  cards,
  viewCards,
  browserCards,
  workflowCards,
  expandedSessionIds,
  dashboardId,
  expandNewChats,
  browserHomepage,
  pendingFocusNoteId,
  selection,
  canvasActions,
  zoom,
  isActive,
  focusedCardId,
  setFocusedCardId,
  getCardRect,
  viewportRef,
  toolbarRef,
  canvasStateRef,
  spawnOriginsRef,
  handleHighlightCard,
  setToolbarOpen,
  setAutoFocusSessionId,
  setPendingSelectSessionId,
  welcomeEligible,
  onWelcomeNewAgent,
  glowingAgentCards,
  glowingBrowserCards,
  measuredHeightsRef,
  measuredHeightsTick,
}: UseDashboardActionHandlersArgs) {
  // ---- Arrow key card navigation (when zoomed in on a card) ----
  const { neighborDirections, shakeDirection } = useArrowNav({
    cards,
    viewCards,
    browserCards,
    workflowCards,
    zoom,
    isActive,
    focusedCardId,
    setFocusedCardId,
    canvasActions,
    getCardRect,
  });

  const {
    handleBranchFromCard,
    handleNewAgent,
    handleToolbarCancel,
    handleToolbarSend,
  } = useAgentSpawn({
    cards,
    expandedSessionIds,
    dashboardId,
    expandNewChats,
    selection,
    canvasActions,
    viewportRef,
    toolbarRef,
    canvasStateRef,
    spawnOriginsRef,
    handleHighlightCard,
    setToolbarOpen,
    setAutoFocusSessionId,
    setPendingSelectSessionId,
    welcomeEligible,
    onWelcomeNewAgent,
  });

  const {
    handleAddView,
    handleAddBrowser,
    handleAddNote,
    handleAddElement,
    handleHistoryResume,
    handleFitToView,
    handleTidy,
  } = useDashboardCardActions({
    expandedSessionIds,
    browserHomepage,
    pendingFocusNoteId,
    selection,
    canvasActions,
    getCardRect,
    viewportRef,
    canvasStateRef,
    handleHighlightCard,
    setAutoFocusSessionId,
  });

  useSiblingRestack({
    isActive,
    expandedSessionIds,
    glowingAgentCards,
    glowingBrowserCards,
    cards,
    browserCards,
    measuredHeightsRef,
    measuredHeightsTick,
  });

  return {
    neighborDirections,
    shakeDirection,
    handleBranchFromCard,
    handleNewAgent,
    handleToolbarCancel,
    handleToolbarSend,
    handleAddView,
    handleAddBrowser,
    handleAddNote,
    handleAddElement,
    handleHistoryResume,
    handleFitToView,
    handleTidy,
  };
}

import { useCallback, useMemo, useRef } from 'react';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useElementSelection } from '@/app/components/editor/ElementSelectionContext';
import { useCanvasControls } from '../../interaction/pointer/useCanvasControls';
import { useDashboardSelection } from '../useDashboardSelection';
import { useDashboardSelectors } from '../useDashboardSelectors';
import { getCardRect } from '../../../geometry/getCardRect';
import { computeContentBounds } from '../../../geometry/contentBounds';
import { useDashboardUiState } from '../useDashboardUiState';
import { useLayoutSave } from '../useLayoutSave';
import { useTethers } from '../../../geometry/dashboardTethers';
import { useDashboardShortcuts } from '../../interaction/useDashboardShortcuts';
import { useDashboardClipboard } from '../../interaction/useDashboardClipboard';
import { useSubAgentLifecycle } from '../../lifecycle/useSubAgentLifecycle';
import { useDashboardLifecycle } from '../../lifecycle/dashboardLifecycle/useDashboardLifecycle';
import { useWelcomeDraft } from '../../lifecycle/useWelcomeDraft';
import { useDashboardThumbnail } from '../useDashboardThumbnail';
import { useWorkflowsMonitorState } from './useWorkflowsMonitorState';
import { useDashboardActionHandlers } from './useDashboardActionHandlers';
import { useDashboardToolbarState } from './useDashboardToolbarState';
import { useDashboardPointerHandlers } from './useDashboardPointerHandlers';

// Composition root for the dashboard. Wires every dashboard hook together and returns exactly the prop bag DashboardCanvas renders. Kept out of Dashboard.tsx so the component file stays a thin shell.
export function useDashboardController(dashboardId: string, isActive: boolean) {
  const c = useClaudeTokens();
  const elementSelectionCtx = useElementSelection();
  const isElementSelectMode = elementSelectionCtx?.selectMode ?? false;
  const {
    dashboardName, sessions, expandedSessionIds, cards, viewCards, browserCards, keepAliveBrowserCards,
    workflowCards, workflowItems, workflowOpenCards, workflowsHub,
    pendingFocusWorkflowId, pendingFocusWorkflowsHub,
    notes, pendingFocusNoteId, elements, layoutInitialized, persistedExpandedSessionIds,
    zoomSensitivity, newAgentShortcut, browserHomepage, expandNewChats,
    autoRevealSubAgents, outputs, outputsLoaded, glowingAgentCards, glowingBrowserCards,
  } = useDashboardSelectors(dashboardId);
  // sessions is the top-level dict; useMemo on its identity so sessionList is stable when sessions hasn't actually changed (RTK only swaps the dict ref when one of its values changes, so this is the right granularity).
  const sessionList = useMemo(() => Object.values(sessions), [sessions]);

  const {
    fullscreenCardId,
    workflowsMonitorCard,
    workflowsMonitorLabel,
    monitorRunSessionId,
  } = useWorkflowsMonitorState(workflowItems);

  const contentBounds = useMemo(
    () => computeContentBounds(cards, viewCards, browserCards, workflowCards, workflowsHub, elements),
    [cards, viewCards, browserCards, workflowCards, workflowsHub, elements],
  );

  const canvas = useCanvasControls(zoomSensitivity, contentBounds, isActive);
  const selection = useDashboardSelection(
    { panX: canvas.panX, panY: canvas.panY, zoom: canvas.zoom, viewportRef: canvas.viewportRef },
    cards,
    viewCards,
    browserCards,
    notes,
    workflowCards,
    workflowsHub,
    elements,
  );
  const {
    toolbarRef, toolbarOpen, setToolbarOpen, searchPaletteOpen, setSearchPaletteOpen,
    highlightedCardId, handleHighlightCard, autoFocusSessionId, setAutoFocusSessionId,
    setPendingSelectSessionId, focusedCardId, setFocusedCardId, newAgentBounce, setNewAgentBounce,
    spawnOriginsRef, measuredHeightsRef, measuredHeightsTick, handleMeasuredHeight,
    revealSpawnedRef, hasFittedRef, restoredExpandedRef,
  } = useDashboardUiState(selection, cards);

  const canvasEmpty = layoutInitialized && sessionList.length === 0
    && Object.keys(viewCards).length === 0 && Object.keys(browserCards).length === 0;

  const canvasStateRef = useRef({ panX: canvas.panX, panY: canvas.panY, zoom: canvas.zoom });
  canvasStateRef.current = { panX: canvas.panX, panY: canvas.panY, zoom: canvas.zoom };
  // Stable getter, AgentCards read pan/zoom on demand during drag math.
  const getCanvasState = useCallback(() => canvasStateRef.current, []);

  // Stable getter so a fullscreen card can size itself against the canvas viewport's real DOM element (sidebar width, insets, banners already resolved) instead of the OS window. Returns the element (not just its rect) so callers can also ResizeObserver it.
  const getViewportEl = useCallback(() => canvas.viewportRef.current, [canvas.viewportRef]);

  const {
    multiDragDelta,
    liveDragInfo,
    handleCardDragStart,
    handleCardDragMove,
    handleCardDragEnd,
    handleCardSelect,
    handleBringToFront,
    handleViewportMouseDown,
    handleViewportMouseMove,
    handleViewportMouseUp,
    handleViewportDoubleClick,
    handleCardDoubleClick,
  } = useDashboardPointerHandlers({
    canvas,
    selection,
    expandedSessionIds,
    isElementSelectMode,
    getCardRect,
    setFocusedCardId,
  });

  const { captureNow } = useDashboardThumbnail({
    isActive,
    dashboardId,
    layoutInitialized,
    viewportRef: canvas.viewportRef,
    contentRef: canvas.contentRef,
  });

  useDashboardLifecycle({
    isActive,
    dashboardId,
    layoutInitialized,
    sessions,
    expandedSessionIds,
    persistedExpandedSessionIds,
    viewCards,
    outputs,
    outputsLoaded,
    canvasActions: canvas.actions,
    handleHighlightCard,
    hasFittedRef,
    restoredExpandedRef,
  });

  // First-run: the onboarding cursor clicks New Agent -> handleNewAgent -> createWelcomeDraft, spawning the welcome chat. A manual New Agent click does the same when eligible.
  const { welcomeEligible, createWelcomeDraft } = useWelcomeDraft({
    dashboardId,
    canvasEmpty,
    expandedSessionIds,
    viewportRef: canvas.viewportRef,
    canvasStateRef,
    spawnOriginsRef,
  });

  // ---- Auto-reveal / collapse / unreveal sub-agent cards ----
  useSubAgentLifecycle({
    isActive,
    sessions,
    cards,
    workflowOpenCards,
    layoutInitialized,
    autoRevealSubAgents,
    expandedSessionIds,
  });

  useLayoutSave({
    isActive,
    layoutInitialized,
    dashboardId,
    cards,
    viewCards,
    browserCards,
    workflowCards,
    workflowsHub,
    notes,
    expandedSessionIds,
    captureNow,
  });

  useDashboardShortcuts({
    isActive,
    newAgentShortcut,
    selection,
    setToolbarOpen,
    setSearchPaletteOpen,
  });

  const {
    toolbarPrefill,
    toolbarPrefillMode,
    handleStarter,
    handleNewAgentBounceEnd,
  } = useDashboardToolbarState({ canvasEmpty, toolbarOpen, setToolbarOpen, setNewAgentBounce });

  useDashboardClipboard({
    isActive,
    dashboardId,
    selection,
    sessions,
    cards,
    viewCards,
    browserCards,
    outputs,
    expandedSessionIds,
  });

  const {
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
  } = useDashboardActionHandlers({
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
    canvasActions: canvas.actions,
    zoom: canvas.zoom,
    isActive,
    focusedCardId,
    setFocusedCardId,
    getCardRect,
    viewportRef: canvas.viewportRef,
    toolbarRef,
    canvasStateRef,
    spawnOriginsRef,
    handleHighlightCard,
    setToolbarOpen,
    setAutoFocusSessionId,
    setPendingSelectSessionId,
    welcomeEligible,
    onWelcomeNewAgent: createWelcomeDraft,
    glowingAgentCards,
    glowingBrowserCards,
    measuredHeightsRef,
    measuredHeightsTick,
  });

  const tethers = useTethers({
    glowingAgentCards,
    glowingBrowserCards,
    cards,
    browserCards,
    workflowCards,
    workflowItems,
    workflowOpenCards,
    viewCards,
    outputs,
    expandedSessionIds,
    liveDragInfo,
    measuredHeightsRef,
    measuredHeightsTick,
    sessionList,
    workflowsHub,
    workflowsMonitorCard,
    workflowsMonitorLabel,
    monitorRunSessionId,
  });

  return {
    c, dashboardId, dashboardName, canvas, selection, sessions, sessionList,
    cards, viewCards, browserCards, keepAliveBrowserCards, notes, elements, outputs, glowingAgentCards,
    workflowCards, workflowsHub,
    expandedSessionIds, tethers, highlightedCardId, autoFocusSessionId,
    focusedCardId, pendingFocusNoteId, multiDragDelta, shakeDirection,
    neighborDirections, toolbarOpen, searchPaletteOpen, newAgentBounce,
    toolbarRef, spawnOriginsRef, revealSpawnedRef, measuredHeightsRef, getCanvasState, getViewportEl,
    fullscreenCardId,
    toolbarPrefill,
    toolbarPrefillMode,
    onStarter: handleStarter,
    onViewportMouseDown: handleViewportMouseDown,
    onViewportMouseMove: handleViewportMouseMove,
    onViewportMouseUp: handleViewportMouseUp,
    onViewportDoubleClick: handleViewportDoubleClick,
    onCardSelect: handleCardSelect,
    onDragStart: handleCardDragStart,
    onDragMove: handleCardDragMove,
    onDragEnd: handleCardDragEnd,
    onCardDoubleClick: handleCardDoubleClick,
    onBringToFront: handleBringToFront,
    onBranch: handleBranchFromCard,
    onMeasuredHeight: handleMeasuredHeight,
    onHighlightCard: handleHighlightCard,
    onNewAgent: handleNewAgent,
    onToolbarCancel: handleToolbarCancel,
    onToolbarSend: handleToolbarSend,
    onAddView: handleAddView,
    onHistoryResume: handleHistoryResume,
    onAddBrowser: handleAddBrowser,
    onAddNote: handleAddNote,
    onAddElement: handleAddElement,
    onNewAgentBounceEnd: handleNewAgentBounceEnd,
    onFitToView: handleFitToView,
    onTidy: handleTidy,
    onSearchPaletteClose: () => setSearchPaletteOpen(false),
  };
}

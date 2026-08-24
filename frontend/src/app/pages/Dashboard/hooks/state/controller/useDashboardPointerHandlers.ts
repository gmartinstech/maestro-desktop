import type { Dispatch, SetStateAction } from 'react';
import { useCardDrag } from '../../interaction/pointer/useCardDrag';
import { useDashboardInteractions } from '../../interaction/useDashboardInteractions';
import type { useCanvasControls } from '../../interaction/pointer/useCanvasControls';
import type { CardType, useDashboardSelection } from '../useDashboardSelection';

type Canvas = ReturnType<typeof useCanvasControls>;
type Selection = ReturnType<typeof useDashboardSelection>;

interface UseDashboardPointerHandlersArgs {
  canvas: Canvas;
  selection: Selection;
  expandedSessionIds: string[];
  isElementSelectMode: boolean;
  getCardRect: (id: string, type: CardType) => { x: number; y: number; width: number; height: number } | undefined;
  setFocusedCardId: Dispatch<SetStateAction<string | null>>;
}

// Card-drag physics and canvas/viewport pointer routing: two hooks that only produce values the composition root forwards to DashboardCanvas, grouped here to keep that root focused on state that actually threads onward.
export function useDashboardPointerHandlers({
  canvas,
  selection,
  expandedSessionIds,
  isElementSelectMode,
  getCardRect,
  setFocusedCardId,
}: UseDashboardPointerHandlersArgs) {
  const {
    multiDragDelta,
    liveDragInfo,
    handleCardDragStart,
    handleCardDragMove,
    handleCardDragEnd,
  } = useCardDrag({
    panX: canvas.panX,
    panY: canvas.panY,
    zoom: canvas.zoom,
    viewportRef: canvas.viewportRef,
    canvasActions: canvas.actions,
    selection,
  });

  const {
    handleCardSelect,
    handleBringToFront,
    handleViewportMouseDown,
    handleViewportMouseMove,
    handleViewportMouseUp,
    handleViewportDoubleClick,
    handleCardDoubleClick,
  } = useDashboardInteractions({
    canvas,
    selection,
    expandedSessionIds,
    isElementSelectMode,
    getCardRect,
    setFocusedCardId,
  });

  return {
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
  };
}

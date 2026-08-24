import { useCallback, useRef, useState } from 'react';
import { setElementPosition, setElementSize } from '@/shared/state/dashboardLayoutSlice';
import { useAppDispatch } from '@/shared/hooks';

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_W = 160;
const MIN_H = 120;

interface UseElementResizeArgs {
  elementId: string;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  getCanvasState: () => { panX: number; panY: number; zoom: number };
}

export function useElementResize({ elementId, cardX, cardY, cardWidth, cardHeight, getCanvasState }: UseElementResizeArgs) {
  const dispatch = useAppDispatch();

  const resizeRef = useRef<{
    dir: ResizeDir; startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [localResize, setLocalResize] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const handleResizeDown = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        dir, startX: e.clientX, startY: e.clientY,
        origX: cardX, origY: cardY, origW: cardWidth, origH: cardHeight,
      };
      setIsResizing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cardX, cardY, cardWidth, cardHeight],
  );

  const computeResize = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeRef.current) return null;
      const { dir, startX, startY, origX, origY, origW, origH } = resizeRef.current;
      const z = getCanvasState().zoom;
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      let newX = origX, newY = origY, newW = origW, newH = origH;
      if (dir.includes('e')) newW = origW + dx;
      if (dir.includes('w')) { newW = origW - dx; newX = origX + dx; }
      if (dir.includes('s')) newH = origH + dy;
      if (dir.includes('n')) { newH = origH - dy; newY = origY + dy; }
      if (newW < MIN_W) { if (dir.includes('w')) newX = origX + origW - MIN_W; newW = MIN_W; }
      if (newH < MIN_H) { if (dir.includes('n')) newY = origY + origH - MIN_H; newH = MIN_H; }
      return { x: newX, y: newY, w: newW, h: newH };
    },
    [getCanvasState],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const result = computeResize(e);
      if (result) setLocalResize(result);
    },
    [computeResize],
  );

  const handleResizeUp = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const result = computeResize(e);
    if (result) {
      dispatch(setElementPosition({ elementId, x: result.x, y: result.y }));
      dispatch(setElementSize({ elementId, width: result.w, height: result.h }));
    }
    resizeRef.current = null;
    setLocalResize(null);
    setIsResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [computeResize, dispatch, elementId]);

  return {
    isResizing,
    localResize,
    handleResizeDown,
    handleResizeMove,
    handleResizeUp,
  };
}

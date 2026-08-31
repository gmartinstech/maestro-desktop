import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import {
  setElementPosition,
  removeElement,
  recordClosedCard,
  ElementKind,
} from '@/shared/state/dashboardLayoutSlice';
import { useAppDispatch } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useElementResize, type ResizeDir } from './useElementResize';

const EDGE_THICKNESS = 6;
const CORNER_SIZE = 14;
const HEADER_H = 18;

const CURSOR_MAP: Record<ResizeDir, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
};

const HANDLE_DEFS: { dir: ResizeDir; sx: Record<string, any> }[] = [
  { dir: 'n',  sx: { top: -EDGE_THICKNESS / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: EDGE_THICKNESS } },
  { dir: 's',  sx: { bottom: -EDGE_THICKNESS / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: EDGE_THICKNESS } },
  { dir: 'w',  sx: { left: -EDGE_THICKNESS / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: EDGE_THICKNESS } },
  { dir: 'e',  sx: { right: -EDGE_THICKNESS / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: EDGE_THICKNESS } },
  { dir: 'nw', sx: { top: -EDGE_THICKNESS / 2, left: -EDGE_THICKNESS / 2, width: CORNER_SIZE, height: CORNER_SIZE } },
  { dir: 'ne', sx: { top: -EDGE_THICKNESS / 2, right: -EDGE_THICKNESS / 2, width: CORNER_SIZE, height: CORNER_SIZE } },
  { dir: 'sw', sx: { bottom: -EDGE_THICKNESS / 2, left: -EDGE_THICKNESS / 2, width: CORNER_SIZE, height: CORNER_SIZE } },
  { dir: 'se', sx: { bottom: -EDGE_THICKNESS / 2, right: -EDGE_THICKNESS / 2, width: CORNER_SIZE, height: CORNER_SIZE } },
];

interface Props {
  elementId: string;
  kind: ElementKind;
  title: string;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  cardZOrder?: number;
  cmdHeld?: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  // Stable getter, ElementCards read pan/zoom on demand during drag math (see AgentCard) instead of receiving them as props — element cards are created in bulk, so per-frame pan/zoom prop churn would re-render all of them on every pan/zoom tick.
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  onCardSelect?: (id: string, type: 'agent' | 'view' | 'browser' | 'note' | 'element', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'agent' | 'view' | 'browser' | 'note' | 'element') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  onBringToFront?: (id: string, type: 'agent' | 'view' | 'browser' | 'note' | 'element') => void;
}

const ElementCard: React.FC<Props> = ({
  elementId, kind, title, cardX, cardY, cardWidth, cardHeight, getCanvasState,
  isSelected = false, isHighlighted = false, multiDragDelta,
  cardZOrder = 0, onCardSelect, onDragStart, onDragMove, onDragEnd, onBringToFront,
}) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const DRAG_THRESHOLD = 3;
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; startPanX: number; startPanY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localDragPos, setLocalDragPos] = useState<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const justDraggedRef = useRef(false);
  const lastPointerRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 });

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cs = getCanvasState();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: cardX, origY: cardY,
      startPanX: cs.panX, startPanY: cs.panY,
    };
    lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    didDrag.current = false;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onDragStart?.(elementId, 'element');
  }, [cardX, cardY, elementId, onDragStart, getCanvasState]);

  const recomputeDragPos = useCallback(() => {
    const ds = dragState.current;
    if (!ds || !didDrag.current) return;
    const { clientX, clientY } = lastPointerRef.current;
    const cs = getCanvasState();
    const rawDx = clientX - ds.startX;
    const rawDy = clientY - ds.startY;
    const z = cs.zoom;
    const panDx = (cs.panX - ds.startPanX) / z;
    const panDy = (cs.panY - ds.startPanY) / z;
    const dx = rawDx / z - panDx;
    const dy = rawDy / z - panDy;
    setLocalDragPos({ x: ds.origX + dx, y: ds.origY + dy });
    onDragMove?.(dx, dy, clientX, clientY);
  }, [onDragMove, getCanvasState]);

  // Dashboard dispatches maestro:canvas-pan-changed during edge-pan/wheel-zoom; only subscribed while dragging.
  useEffect(() => {
    if (!isDragging) return;
    const onPanChange = () => {
      if (didDrag.current) recomputeDragPos();
    };
    window.addEventListener('maestro:canvas-pan-changed', onPanChange);
    return () => window.removeEventListener('maestro:canvas-pan-changed', onPanChange);
  }, [isDragging, recomputeDragPos]);

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const rawDx = e.clientX - dragState.current.startX;
    const rawDy = e.clientY - dragState.current.startY;
    if (!didDrag.current && Math.sqrt(rawDx * rawDx + rawDy * rawDy) < DRAG_THRESHOLD) return;
    didDrag.current = true;
    lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    recomputeDragPos();
  }, [recomputeDragPos]);

  const handleDragPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const cs = getCanvasState();
    const z = cs.zoom;
    const panDx = (cs.panX - dragState.current.startPanX) / z;
    const panDy = (cs.panY - dragState.current.startPanY) / z;
    const dx = (e.clientX - dragState.current.startX) / z - panDx;
    const dy = (e.clientY - dragState.current.startY) / z - panDy;
    if (didDrag.current) {
      let finalX = dragState.current.origX + dx;
      let finalY = dragState.current.origY + dy;
      if (!e.shiftKey) {
        finalX = Math.round(finalX / 24) * 24;
        finalY = Math.round(finalY / 24) * 24;
      }
      dispatch(setElementPosition({ elementId, x: finalX, y: finalY }));
      justDraggedRef.current = true;
      requestAnimationFrame(() => { justDraggedRef.current = false; });
    }
    onDragEnd?.(dx, dy, didDrag.current);
    dragState.current = null;
    didDrag.current = false;
    setLocalDragPos(null);
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dispatch, elementId, onDragEnd, getCanvasState]);

  const {
    isResizing,
    localResize,
    handleResizeDown,
    handleResizeMove,
    handleResizeUp,
  } = useElementResize({ elementId, cardX, cardY, cardWidth, cardHeight, getCanvasState });

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(recordClosedCard({ kind: 'element', id: elementId }));
    dispatch(removeElement({ elementId }));
  };

  const mdDx = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dx : 0;
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const displayX = localResize?.x ?? localDragPos?.x ?? (cardX + mdDx);
  const displayY = localResize?.y ?? localDragPos?.y ?? (cardY + mdDy);
  const displayW = localResize?.w ?? cardWidth;
  const displayH = localResize?.h ?? cardHeight;

  return (
    <Box
      data-select-type="element-card"
      data-select-id={elementId}
      data-select-meta={JSON.stringify({ name: title, kind })}
      onPointerDownCapture={(e: React.PointerEvent) => {
        onBringToFront?.(elementId, 'element');
        // Capture-phase so a click the body swallows still selects the card; shift keeps the bubbled toggle path.
        if (e.button === 0 && !e.shiftKey) onCardSelect?.(elementId, 'element', false);
      }}
      onClick={(e: React.MouseEvent) => {
        if (justDraggedRef.current) return;
        onCardSelect?.(elementId, 'element', e.shiftKey);
      }}
      sx={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        // contain + willChange: own compositor layer so paint stays scoped (see AgentCard for full rationale).
        contain: 'layout style',
        willChange: 'transform',
        borderRadius: `${c.radius.md}px`,
        bgcolor: c.bg.surface,
        border: isHighlighted
          ? `2px solid ${c.accent.primary}`
          : isSelected ? '2px solid #3b82f6' : `1px solid ${c.border.medium}`,
        boxShadow: isHighlighted
          ? `0 0 0 3px ${c.accent.primary}50, 0 0 20px ${c.accent.primary}35`
          : isDragging || isResizing
            ? c.shadow.lg
            : isSelected
              ? `0 0 0 1px #3b82f6, ${c.shadow.md}`
              : c.shadow.sm,
        zIndex: (isDragging || isResizing) ? 999999 : cardZOrder,
        display: 'flex',
        flexDirection: 'column',
        '&:hover .element-controls': { opacity: 1 },
      }}
    >
      {/* Drag header */}
      <Box
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onPointerCancel={handleDragPointerUp}
        sx={{
          height: HEADER_H,
          flexShrink: 0,
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          px: 0.75,
          touchAction: 'none',
        }}
      >
        <Box
          className="element-controls"
          sx={{ opacity: 0, transition: 'opacity 0.15s' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton
            size="small"
            onClick={handleRemove}
            sx={{ p: 0.25, color: c.text.muted, opacity: 0.55, '&:hover': { opacity: 1, bgcolor: 'rgba(0,0,0,0.06)' } }}
          >
            <CloseIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Typed empty state: no content bytes render yet, nothing can serve a local file to the renderer until the asset route lands. */}
      <Box
        sx={{
          position: 'absolute', inset: `${HEADER_H}px 0 0 0`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 0.5,
          color: c.text.muted, fontSize: '0.75rem', userSelect: 'none',
        }}
      >
        <Box sx={{ fontWeight: 600 }}>{title}</Box>
        <Box sx={{ opacity: 0.7 }}>{t('dashboard.element.noAsset', { kind })}</Box>
      </Box>

      {/* Resize handles */}
      {HANDLE_DEFS.map(({ dir, sx }) => (
        <Box
          key={dir}
          onPointerDown={handleResizeDown(dir)}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          sx={{
            position: 'absolute',
            cursor: CURSOR_MAP[dir],
            zIndex: 5,
            touchAction: 'none',
            ...sx,
          }}
        />
      ))}
    </Box>
  );
};

export default React.memo(ElementCard);

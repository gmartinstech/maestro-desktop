import { useState, useCallback, useRef, useEffect, RefObject } from 'react';
import type { CardPosition, ViewCardPosition, BrowserCardPosition, NotePosition, WorkflowCardPosition, WorkflowsHubPosition, ElementPosition } from '@/shared/state/dashboardLayoutSlice';
import { viewCardKey } from '@/shared/state/dashboardLayoutSlice';
import { computeMarqueeSelection } from './computeMarqueeSelection';

export type { CardType } from '@/shared/state/dashboardLayoutSlice';
import type { CardType } from '@/shared/state/dashboardLayoutSlice';

export interface SelectedCard {
  id: string;
  type: CardType;
}

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenToCanvas {
  panX: number;
  panY: number;
  zoom: number;
  viewportRef: RefObject<HTMLDivElement | null>;
}

const DRAG_THRESHOLD = 4;

export function useDashboardSelection(
  canvas: ScreenToCanvas,
  cards: Record<string, CardPosition>,
  viewCards: Record<string, ViewCardPosition>,
  browserCards: Record<string, BrowserCardPosition> = {},
  notes: Record<string, NotePosition> = {},
  workflowCards: Record<string, WorkflowCardPosition> = {},
  workflowsHub: WorkflowsHubPosition | null = null,
  elements: Record<string, ElementPosition> = {},
) {
  const [selectedIds, setSelectedIds] = useState<Map<string, CardType>>(new Map());
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const marqueeOriginRef = useRef<{ screenX: number; screenY: number } | null>(null);
  const isDraggingMarqueeRef = useRef(false);
  const shiftHeldRef = useRef(false);
  const selectionBeforeMarqueeRef = useRef<Map<string, CardType>>(new Map());

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const vp = canvas.viewportRef.current;
      if (!vp) return { x: 0, y: 0 };
      const rect = vp.getBoundingClientRect();
      return {
        x: (screenX - rect.left - canvas.panX) / canvas.zoom,
        y: (screenY - rect.top - canvas.panY) / canvas.zoom,
      };
    },
    [canvas.panX, canvas.panY, canvas.zoom, canvas.viewportRef],
  );

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const deselectAll = useCallback(() => setSelectedIds(new Map()), []);

  // Cmd/Ctrl+A: select every card on the canvas so the user can wipe the board in one keystroke. Mirrors the per-type id keys the marquee uses.
  const selectAll = useCallback(() => {
    const next = new Map<string, CardType>();
    for (const card of Object.values(cards)) next.set(card.session_id, 'agent');
    for (const vc of Object.values(viewCards)) next.set(viewCardKey(vc.output_id, vc.instance), 'view');
    for (const bc of Object.values(browserCards)) next.set(bc.browser_id, 'browser');
    for (const n of Object.values(notes)) next.set(n.note_id, 'note');
    for (const wc of Object.values(workflowCards)) next.set(wc.workflow_id, 'workflow');
    if (workflowsHub) next.set('workflows-hub', 'workflows-hub');
    for (const el of Object.values(elements)) next.set(el.element_id, 'element');
    setSelectedIds(next);
  }, [cards, viewCards, browserCards, notes, workflowCards, workflowsHub, elements]);

  const selectCard = useCallback(
    (id: string, type: CardType, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        if (shiftKey) {
          const next = new Map(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.set(id, type);
          }
          return next;
        }
        // Plain click/press selects the clicked card so spawn-beside-selection actually fires; deselect = empty-canvas click or Esc. An already-selected member keeps the whole selection (a press also starts multi-drag; collapsing would break it) but moves to last so the clicked card is the spawn anchor.
        if (prev.has(id)) {
          if (Array.from(prev.keys()).pop() === id) return prev;
          const next = new Map(prev);
          next.delete(id);
          next.set(id, type);
          return next;
        }
        return new Map([[id, type]]);
      });
    },
    [],
  );

  const selectedArray = useCallback((): SelectedCard[] => {
    return Array.from(selectedIds.entries()).map(([id, type]) => ({ id, type }));
  }, [selectedIds]);

  const computeMarquee = useCallback(
    (rect: MarqueeRect, shiftKey: boolean) => computeMarqueeSelection(
      rect,
      shiftKey,
      selectionBeforeMarqueeRef.current,
      cards,
      viewCards,
      browserCards,
      notes,
      workflowCards,
      workflowsHub,
      elements,
    ),
    [cards, viewCards, browserCards, notes, workflowCards, workflowsHub, elements],
  );

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      // A press starting on a card is a card interaction (select/drag), not a marquee; arming here would make the mouseup deselect the card that was just clicked.
      if ((e.target as HTMLElement)?.closest?.('[data-select-id]')) return;

      marqueeOriginRef.current = { screenX: e.clientX, screenY: e.clientY };
      isDraggingMarqueeRef.current = false;
      shiftHeldRef.current = e.shiftKey;
      selectionBeforeMarqueeRef.current = new Map(selectedIds);
    },
    [selectedIds],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const origin = marqueeOriginRef.current;
      if (!origin) return;

      const dx = e.clientX - origin.screenX;
      const dy = e.clientY - origin.screenY;

      if (!isDraggingMarqueeRef.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        isDraggingMarqueeRef.current = true;
        document.body.style.userSelect = 'none';
        // Disable pointer events on webviews/iframes during drag so the cursor passes through.
        document.body.classList.add('dashboard-marquee-active');
      }

      const start = screenToCanvas(origin.screenX, origin.screenY);
      const end = screenToCanvas(e.clientX, e.clientY);

      const rect: MarqueeRect = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };

      setMarquee(rect);
      setSelectedIds(computeMarquee(rect, shiftHeldRef.current));
    },
    [screenToCanvas, computeMarquee],
  );

  const handleCanvasMouseUp = useCallback(
    (e: MouseEvent) => {
      const origin = marqueeOriginRef.current;
      if (!origin) return;

      if (!isDraggingMarqueeRef.current) {
        if (!e.shiftKey) {
          deselectAll();
        }
      }

      marqueeOriginRef.current = null;
      isDraggingMarqueeRef.current = false;
      setMarquee(null);
      document.body.style.userSelect = '';
      document.body.classList.remove('dashboard-marquee-active');
    },
    [deselectAll],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        deselectAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deselectAll]);

  // Inject (once) a global CSS rule that makes browser webviews and iframes transparent to mouse events while a marquee drag is active. Without this, the Electron <webview> hit-tests the cursor at the OS level, when the cursor lands on an interactable element inside the browser (button, link, text), the webview steals the cursor and the marquee drag visually freezes until the cursor escapes. Setting `pointer-events: none` makes the cursor pass straight through, so the dashboard's mousemove handler continues to fire and the marquee keeps growing smoothly.
  useEffect(() => {
    const id = 'dashboard-marquee-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      body.dashboard-marquee-active webview,
      body.dashboard-marquee-active iframe {
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }, []);

  return {
    selectedIds,
    selectedArray,
    marquee,
    isSelected,
    selectCard,
    deselectAll,
    selectAll,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
  };
}

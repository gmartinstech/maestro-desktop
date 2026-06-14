import { useEffect, useState, useSyncExternalStore } from 'react';

export type CapturableCardType = 'browser' | 'agent';

export const HOVER_CAPTURE_MS = 5000;

interface InternalState {
  hoveredId: string | null;
  hoveredType: CapturableCardType | null;
  hoverStartMs: number;
  selectedIds: Map<string, CapturableCardType>;
}

let state: InternalState = {
  hoveredId: null,
  hoveredType: null,
  hoverStartMs: 0,
  selectedIds: new Map(),
};
const listeners = new Set<() => void>();
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function markHovered(id: string, type: CapturableCardType) {
  if (state.hoveredId === id && state.hoveredType === type) return;
  state = { ...state, hoveredId: id, hoveredType: type, hoverStartMs: performance.now() };
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => { hoverTimer = null; notify(); }, HOVER_CAPTURE_MS);
  notify();
}

export function markUnhovered(id: string) {
  if (state.hoveredId !== id) return;
  state = { ...state, hoveredId: null, hoveredType: null, hoverStartMs: 0 };
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  notify();
}

export function setCardSelected(id: string, type: CapturableCardType, selected: boolean) {
  const prev = state.selectedIds.get(id);
  if (selected && prev === type) return;
  if (!selected && prev === undefined) return;
  const next = new Map(state.selectedIds);
  if (selected) next.set(id, type); else next.delete(id);
  state = { ...state, selectedIds: next };
  notify();
}

export interface CaptureSnapshot {
  hoveredId: string | null;
  hoveredType: CapturableCardType | null;
  capturedId: string | null;
  capturedType: CapturableCardType | null;
}

export function getCaptureState(): CaptureSnapshot {
  const { hoveredId, hoveredType, hoverStartMs, selectedIds } = state;
  if (!hoveredId || !hoveredType) {
    return { hoveredId: null, hoveredType: null, capturedId: null, capturedType: null };
  }
  const isSingleSelected = selectedIds.size === 1 && selectedIds.get(hoveredId) === hoveredType;
  const elapsed = performance.now() - hoverStartMs;
  const captures = isSingleSelected || elapsed >= HOVER_CAPTURE_MS;
  return {
    hoveredId,
    hoveredType,
    capturedId: captures ? hoveredId : null,
    capturedType: captures ? hoveredType : null,
  };
}

function snapshotForId(id: string, type: CapturableCardType): { isHovered: boolean; captures: boolean } {
  const snap = getCaptureState();
  return {
    isHovered: snap.hoveredId === id && snap.hoveredType === type,
    captures: snap.capturedId === id && snap.capturedType === type,
  };
}

// Per-id subscription. useSyncExternalStore requires a stable snapshot reference
// when nothing has changed, so memoize the {isHovered, captures} tuple per call.
export function useCardCapture(id: string, type: CapturableCardType): { isHovered: boolean; captures: boolean } {
  const [{ getSnap }] = useState(() => {
    let cached: { isHovered: boolean; captures: boolean } = snapshotForId(id, type);
    const getSnapFn = () => {
      const next = snapshotForId(id, type);
      if (next.isHovered === cached.isHovered && next.captures === cached.captures) return cached;
      cached = next;
      return cached;
    };
    return { getSnap: getSnapFn };
  });
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

// Mirror a card's `isSelected` prop into the module's selection map so the
// synchronous getCaptureState() reader (called from wheel handlers) stays correct.
export function useReportCardSelection(id: string, type: CapturableCardType, isSelected: boolean) {
  useEffect(() => {
    setCardSelected(id, type, isSelected);
    return () => { setCardSelected(id, type, false); };
  }, [id, type, isSelected]);
}

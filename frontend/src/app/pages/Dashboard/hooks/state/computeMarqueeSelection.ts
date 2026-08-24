import type {
  CardPosition,
  ViewCardPosition,
  BrowserCardPosition,
  NotePosition,
  WorkflowCardPosition,
  WorkflowsHubPosition,
  ElementPosition,
  CardType,
} from '@/shared/state/dashboardLayoutSlice';
import { viewCardKey } from '@/shared/state/dashboardLayoutSlice';

type Rect = { x: number; y: number; width: number; height: number };

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Which cards a marquee rect covers, across every card type the dashboard renders. Shift-drag XORs against the selection captured at drag-start (baseSelection) instead of the live selection, so toggling is stable while the rect grows/shrinks mid-drag.
export function computeMarqueeSelection(
  rect: Rect,
  shiftKey: boolean,
  baseSelection: Map<string, CardType>,
  cards: Record<string, CardPosition>,
  viewCards: Record<string, ViewCardPosition>,
  browserCards: Record<string, BrowserCardPosition>,
  notes: Record<string, NotePosition>,
  workflowCards: Record<string, WorkflowCardPosition>,
  workflowsHub: WorkflowsHubPosition | null,
  elements: Record<string, ElementPosition>,
): Map<string, CardType> {
  const intersecting = new Map<string, CardType>();

  for (const card of Object.values(cards)) {
    if (
      rectsIntersect(rect, {
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
      })
    ) {
      intersecting.set(card.session_id, 'agent');
    }
  }

  for (const vc of Object.values(viewCards)) {
    if (
      rectsIntersect(rect, {
        x: vc.x,
        y: vc.y,
        width: vc.width,
        height: vc.height,
      })
    ) {
      intersecting.set(viewCardKey(vc.output_id, vc.instance), 'view');
    }
  }

  for (const bc of Object.values(browserCards)) {
    if (
      rectsIntersect(rect, {
        x: bc.x,
        y: bc.y,
        width: bc.width,
        height: bc.height,
      })
    ) {
      intersecting.set(bc.browser_id, 'browser');
    }
  }

  for (const n of Object.values(notes)) {
    if (
      rectsIntersect(rect, {
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
      })
    ) {
      intersecting.set(n.note_id, 'note');
    }
  }

  for (const wc of Object.values(workflowCards)) {
    if (
      rectsIntersect(rect, {
        x: wc.x,
        y: wc.y,
        width: wc.width,
        height: wc.height,
      })
    ) {
      intersecting.set(wc.workflow_id, 'workflow');
    }
  }

  if (
    workflowsHub &&
    rectsIntersect(rect, {
      x: workflowsHub.x,
      y: workflowsHub.y,
      width: workflowsHub.width,
      height: workflowsHub.height,
    })
  ) {
    intersecting.set('workflows-hub', 'workflows-hub');
  }

  for (const el of Object.values(elements)) {
    if (
      rectsIntersect(rect, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      })
    ) {
      intersecting.set(el.element_id, 'element');
    }
  }

  if (shiftKey) {
    const next = new Map(baseSelection);
    for (const [id, type] of intersecting) {
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, type);
      }
    }
    return next;
  }

  return intersecting;
}

import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { CardPosition, WorkflowCardPosition } from '@/shared/state/dashboardLayoutSlice';
import { EXPANDED_CARD_MIN_H } from '@/shared/state/dashboardLayoutSlice';
import type { Workflow, OpenCard } from '@/shared/state/workflowsSlice';
import { elbowPath, borderPoint, rectCenter, bestAnchorPath, type Anchor, type Tether } from './tetherGeometry';

interface LiveDragInfo {
  cardId: string;
  dx: number;
  dy: number;
}

interface BuildWorkflowTethersArgs {
  workflowCards: Record<string, WorkflowCardPosition>;
  cards: Record<string, CardPosition>;
  workflowItems: Record<string, Workflow>;
  workflowOpenCards: Record<string, OpenCard>;
  liveDragInfo: LiveDragInfo | null;
  measuredHeightsRef: RefObject<Record<string, number>>;
  expandedSessionIds: string[];
  t: TFunction;
}

// "Make workflow" tethers (workflow card <- source agent) plus sidecar tethers (workflow card <-> its View/Watch/Test agent session). Reuses the browser-tether anchor/elbow math; skips deleted workflows to avoid dangling arrows.
export function buildWorkflowTethers({
  workflowCards,
  cards,
  workflowItems,
  workflowOpenCards,
  liveDragInfo,
  measuredHeightsRef,
  expandedSessionIds,
  t,
}: BuildWorkflowTethersArgs): Tether[] {
  const wfHeight = (wc: WorkflowCardPosition): number =>
    measuredHeightsRef.current![wc.workflow_id] ?? wc.height;

  const workflowTethers: Tether[] = [];
  for (const wc of Object.values(workflowCards)) {
    const sourceId = wc.source_session_id;
    if (!sourceId) continue;
    const src = cards[sourceId];
    if (!src) continue;
    // Layout entry can outlive its workflow when deleted from the hub.
    const hasReal = wc.workflow_id in workflowItems;
    const hasDraft = wc.workflow_id in workflowOpenCards;
    if (!hasReal && !hasDraft) continue;
    // "Make workflow" is a draft-time affordance; once saved (openCard leaves 'preview') the link retires.
    const openCard = workflowOpenCards[wc.workflow_id];
    if (openCard && openCard.view !== 'preview') continue;

    let srcX = src.x, srcY = src.y;
    let dstX = wc.x, dstY = wc.y;
    if (liveDragInfo) {
      if (liveDragInfo.cardId === sourceId) { srcX += liveDragInfo.dx; srcY += liveDragInfo.dy; }
      if (liveDragInfo.cardId === wc.workflow_id) { dstX += liveDragInfo.dx; dstY += liveDragInfo.dy; }
    }

    const srcMeasured = measuredHeightsRef.current![sourceId];
    const srcH = srcMeasured ?? (expandedSessionIds.includes(sourceId)
      ? Math.max(EXPANDED_CARD_MIN_H, src.height)
      : src.height);

    const wcH = wfHeight(wc);
    const srcCx = srcX + src.width / 2;
    const dstCx = dstX + wc.width / 2;
    const srcAnchors: Anchor[] = [
      { x: srcX + src.width, y: srcY + srcH * 0.54, side: 'right' },
      { x: srcX, y: srcY + srcH * 0.54, side: 'left' },
      { x: srcCx, y: srcY, side: 'top' },
      { x: srcCx, y: srcY + srcH, side: 'bottom' },
    ];
    const dstAnchors: Anchor[] = [
      { x: dstX, y: dstY + wcH * 0.54, side: 'left' },
      { x: dstX + wc.width, y: dstY + wcH * 0.54, side: 'right' },
      { x: dstCx, y: dstY, side: 'top' },
      { x: dstCx, y: dstY + wcH, side: 'bottom' },
    ];
    const { x1, y1, x2, y2, path: pathD, isVertical } = bestAnchorPath(srcAnchors, dstAnchors);
    const midX = x1 + (x2 - x1) / 2;
    const midY = y1 + (y2 - y1) / 2;
    const labelX = isVertical ? midX : midX + (x2 - midX) * 0.15;
    const labelY = isVertical ? midY + (y2 - midY) * 0.15 : y2;
    workflowTethers.push({
      key: `workflow-${wc.workflow_id}`,
      path: pathD,
      labelX,
      labelY,
      label: t('dashboard.tether.makeWorkflow'),
      fading: false,
    });
  }

  // Sidecar tethers: workflow card to its sibling agent session (View Agent / Watch Live / Test Agent).
  for (const wc of Object.values(workflowCards)) {
    const openCard = workflowOpenCards[wc.workflow_id];
    if (!openCard?.sidecarSessionId || !openCard.sidecarKind) continue;
    const sidecarId = openCard.sidecarSessionId;
    const sidecar = cards[sidecarId];
    if (!sidecar) continue;
    let srcX = wc.x, srcY = wc.y;
    let dstX = sidecar.x, dstY = sidecar.y;
    if (liveDragInfo) {
      if (liveDragInfo.cardId === wc.workflow_id) { srcX += liveDragInfo.dx; srcY += liveDragInfo.dy; }
      if (liveDragInfo.cardId === sidecarId) { dstX += liveDragInfo.dx; dstY += liveDragInfo.dy; }
    }
    const dstMeasured = measuredHeightsRef.current![sidecarId];
    const dstH = dstMeasured ?? (expandedSessionIds.includes(sidecarId)
      ? Math.max(EXPANDED_CARD_MIN_H, sidecar.height)
      : sidecar.height);
    const wcH = wfHeight(wc);
    const workflowRect = { x: srcX, y: srcY, width: wc.width, height: wcH };
    const sidecarRect = { x: dstX, y: dstY, width: sidecar.width, height: dstH };
    const srcCenter = rectCenter(workflowRect);
    const dstCenter = rectCenter(sidecarRect);
    const a = borderPoint(workflowRect.x, workflowRect.y, workflowRect.width, workflowRect.height, dstCenter.x, dstCenter.y);
    const b = borderPoint(sidecarRect.x, sidecarRect.y, sidecarRect.width, sidecarRect.height, srcCenter.x, srcCenter.y);
    const x1 = a.x, y1 = a.y;
    const x2 = b.x, y2 = b.y;
    const pathD = elbowPath(x1, y1, x2, y2);
    const midX = x1 + (x2 - x1) / 2;
    const midY = y1 + (y2 - y1) / 2;
    const sidecarLabel = openCard.sidecarKind === 'testing' ? t('dashboard.tether.testing') : t('dashboard.tether.watching');
    workflowTethers.push({
      key: `sidecar-${wc.workflow_id}`,
      path: pathD,
      labelX: midX,
      labelY: midY,
      label: sidecarLabel,
      fading: false,
    });
  }

  return workflowTethers;
}

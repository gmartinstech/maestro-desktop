import type { RefObject } from 'react';
import type { WorkflowsHubPosition } from '@/shared/state/dashboardLayoutSlice';
import { EXPANDED_CARD_MIN_H } from '@/shared/state/dashboardLayoutSlice';
import type { AgentSession } from '@/shared/state/agentsSlice';
import { bestAnchorPath, type Anchor, type Tether } from './tetherGeometry';

interface LiveDragInfo {
  cardId: string;
  dx: number;
  dy: number;
}

export interface CardTetherContext {
  sessionById: Map<string, AgentSession>;
  workflowsMonitorCard: WorkflowsHubPosition | null;
  monitorRunSessionId: string | null;
  workflowsHub: WorkflowsHubPosition | null;
  cards: Record<string, { x: number; y: number; width: number; height: number }>;
  liveDragInfo: LiveDragInfo | null;
  measuredHeightsRef: RefObject<Record<string, number>>;
  expandedSessionIds: string[];
}

// Workflow chats have no standalone agent card: a run anchors to the monitor card, an edit/compose chat to the hub window, so the browser tether lands on the workflow surface instead of nothing.
export function buildCardTether(
  ctx: CardTetherContext,
  dst: { x: number; y: number; width: number; height: number } | undefined,
  dstId: string,
  sourceId: string,
  key: string,
  label: string,
  fading: boolean,
): Tether | null {
  const { sessionById, workflowsMonitorCard, monitorRunSessionId, workflowsHub, cards, liveDragInfo, measuredHeightsRef, expandedSessionIds } = ctx;

  const srcSession = sessionById.get(sourceId);
  const srcIsMonitor = !!workflowsMonitorCard && sourceId === monitorRunSessionId;
  const srcIsHub = !srcIsMonitor && !!workflowsHub && !!srcSession?.workflow_edit_id;
  const src = srcIsMonitor ? workflowsMonitorCard : srcIsHub ? workflowsHub : cards[sourceId];
  if (!src || !dst) return null;

  const srcDragId = srcIsMonitor ? 'workflows-monitor' : srcIsHub ? 'workflows-hub' : sourceId;
  let srcX = src.x, srcY = src.y;
  let dstX = dst.x, dstY = dst.y;
  if (liveDragInfo) {
    if (liveDragInfo.cardId === srcDragId) { srcX += liveDragInfo.dx; srcY += liveDragInfo.dy; }
    if (liveDragInfo.cardId === dstId) { dstX += liveDragInfo.dx; dstY += liveDragInfo.dy; }
  }

  const srcMeasured = measuredHeightsRef.current![sourceId];
  const srcH = srcMeasured ?? (expandedSessionIds.includes(sourceId)
    ? Math.max(EXPANDED_CARD_MIN_H, src.height)
    : src.height);
  const dstH = dst.height;

  const srcCx = srcX + src.width / 2;
  const dstCx = dstX + dst.width / 2;

  const srcAnchors: Anchor[] = [
    { x: srcX + src.width, y: srcY + srcH * 0.54, side: 'right' },
    { x: srcX, y: srcY + srcH * 0.54, side: 'left' },
    { x: srcCx, y: srcY, side: 'top' },
    { x: srcCx, y: srcY + srcH, side: 'bottom' },
  ];
  const dstAnchors: Anchor[] = [
    { x: dstX, y: dstY + dstH * 0.54, side: 'left' },
    { x: dstX + dst.width, y: dstY + dstH * 0.54, side: 'right' },
    { x: dstCx, y: dstY, side: 'top' },
    { x: dstCx, y: dstY + dstH, side: 'bottom' },
  ];

  const { x1, y1, x2, y2, path: pathD } = bestAnchorPath(srcAnchors, dstAnchors);

  const midX = x1 + (x2 - x1) / 2;
  const midY = y1 + (y2 - y1) / 2;
  // Center the pill on the line midpoint: the box is left-anchored at labelX, so back off half its text width (same trick as the monitor "Watching" label).
  const labelX = midX - (label.length * 7.5) / 2;
  const labelY = midY;

  return {
    key,
    path: pathD,
    labelX,
    labelY,
    label,
    fading,
  };
}

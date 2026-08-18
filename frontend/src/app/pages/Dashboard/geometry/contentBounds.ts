import type {
  CardPosition,
  ViewCardPosition,
  BrowserCardPosition,
  WorkflowCardPosition,
  WorkflowsHubPosition,
  ElementPosition,
} from '@/shared/state/dashboardLayoutSlice';

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Bounding box over agent + view + browser + workflow + element cards. Notes are intentionally excluded (they're annotations, not content); elements ARE included (they're content, like images/diagrams/files). Returns undefined for an empty canvas.
export function computeContentBounds(
  cards: Record<string, CardPosition>,
  viewCards: Record<string, ViewCardPosition>,
  browserCards: Record<string, BrowserCardPosition>,
  workflowCards: Record<string, WorkflowCardPosition> = {},
  workflowsHub: WorkflowsHubPosition | null = null,
  elements: Record<string, ElementPosition> = {},
): ContentBounds | undefined {
  const allRects = [
    ...Object.values(cards).map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })),
    ...Object.values(viewCards).map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })),
    ...Object.values(browserCards).map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })),
    ...Object.values(workflowCards).map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })),
    ...(workflowsHub ? [{ x: workflowsHub.x, y: workflowsHub.y, w: workflowsHub.width, h: workflowsHub.height }] : []),
    ...Object.values(elements).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height })),
  ];
  if (allRects.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of allRects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

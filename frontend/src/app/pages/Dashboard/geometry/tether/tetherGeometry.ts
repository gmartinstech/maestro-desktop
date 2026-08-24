export const ELBOW_RADIUS = 16;

export interface Tether {
  key: string;
  path: string;
  labelX: number;
  labelY: number;
  label: string;
  fading: boolean;
}

export type Anchor = { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' };
export type CanvasRect = { x: number; y: number; width: number; height: number };

export function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const midX = x1 + dx / 2;
  const r = (Math.abs(dy) < 1 || Math.abs(dx) < ELBOW_RADIUS * 2)
    ? 0
    : Math.min(ELBOW_RADIUS, Math.abs(dy) / 2, Math.abs(dx) / 4);
  const sy = dy >= 0 ? 1 : -1;
  const sx = dx >= 0 ? 1 : -1;

  return [
    `M ${x1},${y1}`,
    `H ${midX - sx * r}`,
    `Q ${midX},${y1} ${midX},${y1 + sy * r}`,
    `V ${y2 - sy * r}`,
    `Q ${midX},${y2} ${midX + sx * r},${y2}`,
    `H ${x2}`,
  ].join(' ');
}

// Where the ray from a rect's center toward (tx,ty) crosses the rect border. Pins a tether endpoint to the card edge facing the other card, so it can never float in empty space the way nearest-corner anchoring could.
export function borderPoint(x: number, y: number, w: number, h: number, tx: number, ty: number): { x: number; y: number } {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = 1 / Math.max(Math.abs(dx) / (w / 2), Math.abs(dy) / (h / 2));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function rectCenter(r: CanvasRect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// Shared by cardTether and the workflow-tether loop: picks the closest facing anchor pair between two rects, then routes an elbow (or vertical S-curve when both anchors face top/bottom).
export function bestAnchorPath(
  srcAnchors: Anchor[],
  dstAnchors: Anchor[],
): { x1: number; y1: number; x2: number; y2: number; path: string; isVertical: boolean } {
  let bestSrc = srcAnchors[0], bestDst = dstAnchors[0];
  let bestDist = Infinity;
  for (const sa of srcAnchors) {
    for (const da of dstAnchors) {
      const d = Math.hypot(sa.x - da.x, sa.y - da.y);
      if (d < bestDist) { bestDist = d; bestSrc = sa; bestDst = da; }
    }
  }

  const x1 = bestSrc.x, y1 = bestSrc.y;
  const x2 = bestDst.x, y2 = bestDst.y;

  const isVertical = (bestSrc.side === 'top' || bestSrc.side === 'bottom')
    && (bestDst.side === 'top' || bestDst.side === 'bottom');

  let path: string;
  if (isVertical) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const midY = y1 + dy / 2;
    const r = (Math.abs(dx) < 1 || Math.abs(dy) < ELBOW_RADIUS * 2)
      ? 0
      : Math.min(ELBOW_RADIUS, Math.abs(dx) / 2, Math.abs(dy) / 4);
    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    path = [
      `M ${x1},${y1}`,
      `V ${midY - sy * r}`,
      `Q ${x1},${midY} ${x1 + sx * r},${midY}`,
      `H ${x2 - sx * r}`,
      `Q ${x2},${midY} ${x2},${midY + sy * r}`,
      `V ${y2}`,
    ].join(' ');
  } else {
    path = elbowPath(x1, y1, x2, y2);
  }

  return { x1, y1, x2, y2, path, isVertical };
}

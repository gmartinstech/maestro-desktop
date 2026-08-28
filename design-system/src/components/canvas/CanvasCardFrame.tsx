import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../cx';

export interface CanvasCardFrameProps {
  x: number;
  y: number;
  width: number;
  height: number | 'auto';
  /** Selection uses the app's hardcoded #3b82f6 — there is no token for it, on purpose. */
  selected?: boolean;
  /** The 3-layer accent halo a card gets right after being created or jumped to via search. */
  highlighted?: boolean;
  radius?: number;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * The shared visual recipe every canvas card re-implements by hand in the real app
 * (AgentCard, BrowserCard, DashboardViewCard, NoteCard, WorkflowsAppCard, RunMonitor all
 * duplicate this). Centralised here as the one thing a design system should fix.
 */
export function CanvasCardFrame({
  x,
  y,
  width,
  height,
  selected = false,
  highlighted = false,
  radius = 8,
  children,
  style,
  className,
}: CanvasCardFrameProps) {
  return (
    <div
      className={cx('mds-canvas-card', selected && 'mds-canvas-card--selected', highlighted && 'mds-canvas-card--highlighted', className)}
      style={{ left: x, top: y, width, height, borderRadius: radius, ...style }}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';
import { cx } from '../cx';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot — the app uses it for agent run states. */
  dot?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Compact status pill. Tones map onto the status token pairs, so they stay legible in dark mode. */
export function Badge({ tone = 'neutral', dot = false, children, className }: BadgeProps) {
  return (
    <span className={cx('mds-badge', `mds-badge--${tone}`, className)}>
      {dot && <span className="mds-badge__dot" />}
      {children}
    </span>
  );
}

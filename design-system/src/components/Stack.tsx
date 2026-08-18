import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export type StackGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10;

export interface StackProps {
  /** Layout axis. `row` is the toolbar/button-group case. */
  direction?: 'row' | 'column';
  /** Step on the 4px spacing scale — 4 means 16px. */
  gap?: StackGap;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Flex layout primitive spending the shared spacing scale instead of ad-hoc margins. */
export function Stack({
  direction = 'column',
  gap = 3,
  align,
  justify,
  wrap = false,
  children,
  className,
  style,
}: StackProps) {
  return (
    <div
      className={cx('mds-stack', className)}
      style={{
        display: 'flex',
        flexDirection: direction,
        gap: gap === 0 ? 0 : `var(--mds-space-${gap})`,
        alignItems: align,
        justifyContent: justify,
        flexWrap: wrap ? 'wrap' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface GridProps {
  /** Column count. The app's dashboards use 4 for stats and 2-3 for cards. */
  columns?: 2 | 3 | 4;
  gap?: StackGap;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Equal-column grid for stat rows and card galleries. */
export function Grid({ columns = 3, gap = 4, children, className, style }: GridProps) {
  return (
    <div
      className={cx('mds-grid', `mds-grid--${columns}`, className)}
      style={{ gap: `var(--mds-space-${gap})`, ...style }}
    >
      {children}
    </div>
  );
}

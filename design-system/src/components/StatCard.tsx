import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface StatCardProps {
  /** Uppercase metric name, e.g. "Active agents". */
  label: string;
  /** The number. Pre-format it — the card does not round or localise. */
  value: ReactNode;
  /** Signed change vs the previous period, e.g. "+12.4%". */
  delta?: string;
  /** Colours the delta. `flat` is the neutral grey used for unchanged metrics. */
  trend?: 'up' | 'down' | 'flat';
  /** Small glyph on the right of the label row. */
  icon?: ReactNode;
  /** Sub-line under the delta — the comparison window. */
  caption?: string;
  className?: string;
}

/** Single KPI tile. Values use tabular numerals so a row of these stays aligned. */
export function StatCard({
  label,
  value,
  delta,
  trend = 'flat',
  icon,
  caption,
  className,
}: StatCardProps) {
  return (
    <div className={cx('mds-stat', className)}>
      <div className="mds-stat__tag">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mds-stat__val">{value}</div>
      {delta && <div className={cx('mds-stat__delta', `mds-stat__delta--${trend}`)}>{delta}</div>}
      {caption && (
        <div style={{ fontSize: 12, color: 'var(--mds-text-muted)', marginTop: 4 }}>{caption}</div>
      )}
    </div>
  );
}

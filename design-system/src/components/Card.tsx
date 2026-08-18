import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export interface CardProps {
  /** Card title. Omit both title and actions to get a bare surface. */
  title?: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /** Right side of the header — icon buttons, badges, a small menu. */
  actions?: ReactNode;
  /** compact = tighter padding for dense grids; flush = no padding, for tables and lists. */
  padding?: 'default' | 'compact' | 'flush';
  /** Hover affordance for cards that navigate. */
  interactive?: boolean;
  /** Accent ring for the current selection in a gallery. */
  selected?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** The app's standard surface: elevated panel, hairline border, 8px radius. */
export function Card({
  title,
  subtitle,
  actions,
  padding = 'default',
  interactive = false,
  selected = false,
  onClick,
  children,
  className,
  style,
}: CardProps) {
  return (
    <div
      className={cx(
        'mds-card',
        padding === 'compact' && 'mds-card--compact',
        padding === 'flush' && 'mds-card--flush',
        interactive && 'mds-card--interactive',
        selected && 'mds-card--selected',
        className,
      )}
      onClick={onClick}
      style={style}
    >
      {(title || actions) && (
        <div className="mds-card__head" style={padding === 'flush' ? { padding: 16, marginBottom: 0 } : undefined}>
          <div>
            {title && <h3 className="mds-card__title">{title}</h3>}
            {subtitle && <div className="mds-card__sub">{subtitle}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

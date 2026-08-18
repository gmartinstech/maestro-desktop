import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface EmptyStateProps {
  title: string;
  /** One or two sentences saying what would fill this space and how to get there. */
  description?: string;
  /** Glyph in the token-tinted circle. */
  icon?: ReactNode;
  /** The single action that resolves the emptiness. */
  action?: ReactNode;
  className?: string;
}

/** Zero-data placeholder. Every list surface in the app has one of these. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('mds-empty', className)}>
      {icon && <div className="mds-empty__icon">{icon}</div>}
      <div className="mds-empty__title">{title}</div>
      {description && <div className="mds-empty__body">{description}</div>}
      {action}
    </div>
  );
}

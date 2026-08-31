import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  tone?: AlertTone;
  /** Bold first line. Omit for a single-sentence notice. */
  title?: string;
  /** Trailing controls — a Retry button, a dismiss IconButton. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const TONE_ICON: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/** Inline, in-flow notice. For transient feedback that should not reflow the page, use Toast. */
export function Alert({ tone = 'info', title, action, children, className }: AlertProps) {
  return (
    <div className={cx('mds-alert', `mds-alert--${tone}`, className)} role="status">
      <span className="mds-alert__icon">
        <Icon name={TONE_ICON[tone]} size={16} />
      </span>
      <div className="mds-alert__body">
        {title && <div className="mds-alert__title">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

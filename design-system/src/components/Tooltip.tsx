import { useState, type ReactNode } from 'react';
import { cx } from '../cx';

export interface TooltipProps {
  /** The tip text. Keep it to a few words — it never wraps. */
  content: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Force the tip visible. Set it in previews and docs; leave unset in the app. */
  open?: boolean;
  children: ReactNode;
  className?: string;
}

/** Hover/focus tip in the inverse surface colour. Wrap the trigger, do not style it. */
export function Tooltip({ content, placement = 'top', open, children, className }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const visible = open ?? hovered;
  return (
    <span
      className={cx('mds-tooltip-wrap', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {children}
      {visible && (
        <span role="tooltip" className={cx('mds-tooltip', `mds-tooltip--${placement}`)}>
          {content}
        </span>
      )}
    </span>
  );
}

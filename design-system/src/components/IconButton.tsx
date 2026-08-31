import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The glyph. Use `<Icon />` at 16px (18px at size lg) to match the app's icon language. */
  icon: ReactNode;
  /** Required — it is the control's only accessible name. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  /** Held-open / selected state, e.g. a toggled panel button in the title bar. */
  active?: boolean;
  /** Gold pip in the top-right corner, for unseen activity. */
  dot?: boolean;
}

/** Square, label-less control for title bars, card headers and table row actions. */
export function IconButton({
  icon,
  label,
  size = 'md',
  active = false,
  dot = false,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'mds-iconbtn',
        size !== 'md' && `mds-iconbtn--${size}`,
        active && 'mds-iconbtn--active',
        className,
      )}
      {...rest}
    >
      {icon}
      {dot && <span className="mds-iconbtn__dot" />}
    </button>
  );
}

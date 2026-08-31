import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** primary = navy fill (the default action). accent = gold, reserved for one highlight per view. */
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Swaps the leading icon for a spinner and blocks interaction. */
  loading?: boolean;
  /** Fill the container width — used in dialog footers and narrow panels. */
  block?: boolean;
  /** Rendered before the label; pass `<Icon name="…" size={15} />` to match the monoline set. */
  icon?: ReactNode;
  /** Rendered after the label — chevrons, counts, external-link marks. */
  trailing?: ReactNode;
  children?: ReactNode;
}

/**
 * The standard action control. Gold (`accent`) always sits on dark ink and should appear at
 * most once per view; everything secondary uses `secondary` or `ghost`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  trailing,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'mds-btn',
        `mds-btn--${variant}`,
        size !== 'md' && `mds-btn--${size}`,
        block && 'mds-btn--block',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="mds-spinner mds-spinner--sm" aria-hidden="true" /> : icon}
      {children}
      {trailing}
    </button>
  );
}

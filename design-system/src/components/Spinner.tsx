import { cx } from '../cx';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label announced while the work is in flight. */
  label?: string;
  className?: string;
}

/** Indeterminate progress ring, tinted with the accent token. */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx('mds-spinner', size !== 'md' && `mds-spinner--${size}`, className)}
    />
  );
}

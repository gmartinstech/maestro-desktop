import { cx } from '../cx';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** Centres a caption in the rule — the "or" separator on the sign-in panel. */
  label?: string;
  className?: string;
}

/** Hairline rule at the subtle border token. */
export function Divider({ orientation = 'horizontal', label, className }: DividerProps) {
  if (label) {
    return <div className={cx('mds-divider', 'mds-divider--labelled', className)}>{label}</div>;
  }
  return (
    <hr
      className={cx('mds-divider', orientation === 'vertical' && 'mds-divider--vertical', className)}
    />
  );
}

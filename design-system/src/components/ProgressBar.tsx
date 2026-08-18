import { cx } from '../cx';

export interface ProgressBarProps {
  /** 0-100. Values outside the range are clamped. */
  value: number;
  /** Caption on the left of the row above the track. */
  label?: string;
  /** Right side of that row — defaults to the percentage when `showValue` is set. */
  hint?: string;
  showValue?: boolean;
  /** gold for update downloads, error for failing runs, accent everywhere else. */
  tone?: 'accent' | 'gold' | 'error';
  className?: string;
}

/** Determinate progress track — update downloads, workflow completion, quota use. */
export function ProgressBar({
  value,
  label,
  hint,
  showValue = false,
  tone = 'accent',
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {(label || hint || showValue) && (
        <div className="mds-progress-row">
          <span>{label}</span>
          <span>{hint ?? (showValue ? `${Math.round(pct)}%` : null)}</span>
        </div>
      )}
      <div
        className="mds-progress"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cx('mds-progress__fill', tone !== 'accent' && `mds-progress__fill--${tone}`)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

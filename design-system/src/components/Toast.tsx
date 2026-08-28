import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastProps {
  /** The message. It is clipped to one line, so keep it short. */
  message: string;
  tone?: ToastTone;
  /** Label of the single trailing action, rendered in gold. */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'success',
  error: 'error',
};

/**
 * The floating pill the app calls its Dynamic Island — always on the inverse surface,
 * one line, at most one action. Stack them with `AppShell`'s `toasts` slot.
 */
export function Toast({ message, tone = 'info', actionLabel, onAction, className }: ToastProps) {
  return (
    <div className={cx('mds-toast', `mds-toast--${tone}`, className)} role="status">
      <span className="mds-toast__icon">
        <Icon name={TONE_ICON[tone]} size={16} />
      </span>
      <span className="mds-toast__msg">{message}</span>
      {actionLabel && (
        <button type="button" className="mds-toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

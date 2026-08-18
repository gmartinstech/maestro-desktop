import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';

export interface ModalProps {
  /** Controls visibility. The component renders nothing when false. */
  open: boolean;
  title: string;
  /** Secondary line under the title — what the dialog will do. */
  subtitle?: string;
  /** Footer controls. Put the confirming Button last, on the right. */
  footer?: ReactNode;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  className?: string;
}

/**
 * Centred dialog over a scrim. The scrim is absolutely positioned, so the nearest
 * positioned ancestor bounds it — mount inside `AppShell`, not at the document root.
 */
export function Modal({
  open,
  title,
  subtitle,
  footer,
  onClose,
  size = 'md',
  children,
  className,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="mds-modal-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('mds-modal', size !== 'md' && `mds-modal--${size}`, className)}
      >
        <div className="mds-modal__head">
          <div>
            <h2 className="mds-modal__title">{title}</h2>
            {subtitle && <div className="mds-modal__sub">{subtitle}</div>}
          </div>
          {onClose && (
            <button
              type="button"
              className="mds-iconbtn mds-iconbtn--sm"
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
        <div className="mds-modal__body">{children}</div>
        {footer && <div className="mds-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

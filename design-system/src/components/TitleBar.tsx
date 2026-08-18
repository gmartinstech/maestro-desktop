import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface TitleBarProps {
  /**
   * Which OS chrome to leave room for. `win` reserves 138px on the right for the
   * minimise/maximise/close overlay; `mac` reserves 78px on the left for the traffic
   * lights. Getting this wrong puts controls underneath the native buttons.
   */
  platform?: 'win' | 'mac';
  /** Far left of the bar — normally the MaestroLogo. */
  leading?: ReactNode;
  /** Centred window title, shown small and tertiary. */
  title?: string;
  /** Back/forward and panel toggles, grouped beside the leading slot. */
  nav?: ReactNode;
  /** Trailing cluster, inside the reserved gutter. */
  actions?: ReactNode;
  className?: string;
}

/** The app's 38px custom title bar. It is draggable chrome — keep it sparse. */
export function TitleBar({
  platform = 'win',
  leading,
  title,
  nav,
  actions,
  className,
}: TitleBarProps) {
  return (
    <div className={cx('mds-titlebar', `mds-titlebar--${platform}`, className)}>
      {leading}
      {nav && <div className="mds-titlebar__nav">{nav}</div>}
      <div className="mds-titlebar__spacer" />
      {title && <span className="mds-titlebar__title">{title}</span>}
      <div className="mds-titlebar__spacer" />
      {actions && <div className="mds-titlebar__nav">{actions}</div>}
    </div>
  );
}

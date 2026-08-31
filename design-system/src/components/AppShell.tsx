import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export interface AppShellProps {
  /** The TitleBar. Fixed at 38px; it never scrolls. */
  titleBar?: ReactNode;
  /** The Sidebar. Omit for a full-bleed window such as the login screen. */
  sidebar?: ReactNode;
  /** Toast pills, bottom-centred over the content. */
  toasts?: ReactNode;
  /** Modal or CommandPalette overlay — the scrim is bounded by this shell. */
  overlay?: ReactNode;
  /** Drop the 24px content padding for panes that manage their own (chat, canvas). */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The desktop window frame: title bar across the top, navigation rail on the left,
 * scrolling content on the right, with toast and overlay layers stacked above.
 * Give it a fixed height (its parent usually sets 100vh) — the content pane scrolls, the frame does not.
 */
export function AppShell({
  titleBar,
  sidebar,
  toasts,
  overlay,
  flush = false,
  children,
  className,
  style,
}: AppShellProps) {
  return (
    <div className={cx('mds-shell', className)} style={style}>
      {titleBar}
      <div className="mds-shell__body">
        {sidebar}
        <main className={cx('mds-shell__main', flush && 'mds-shell__main--flush')}>{children}</main>
      </div>
      {toasts && <div className="mds-shell__toasts">{toasts}</div>}
      {overlay}
    </div>
  );
}

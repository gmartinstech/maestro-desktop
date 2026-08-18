import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export interface ThemeProviderProps {
  /** Which token set to apply. Dark swaps every --mds-* colour on the same element. */
  theme?: 'light' | 'dark';
  /** Stretch to fill the available space — what an app root wants, a card preview does not. */
  fullHeight?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Root wrapper that installs the Maestro token layer. Every other component reads its
 * colours, fonts and spacing from the custom properties this element defines, so anything
 * rendered outside a ThemeProvider comes out unstyled with browser-default type.
 */
export function ThemeProvider({
  theme = 'light',
  fullHeight = false,
  children,
  className,
  style,
}: ThemeProviderProps) {
  return (
    <div
      className={cx('mds-root', className)}
      data-theme={theme}
      style={{ ...(fullHeight ? { height: '100%' } : null), ...style }}
    >
      {children}
    </div>
  );
}

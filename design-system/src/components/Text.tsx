import { createElement, type ReactNode } from 'react';
import { cx } from '../cx';

export interface TextProps {
  /** primary = body copy, secondary = default, muted = de-emphasised metadata. */
  tone?: 'primary' | 'secondary' | 'muted';
  size?: 'sm' | 'md' | 'lg';
  /** IBM Plex Mono — ids, paths, durations, anything the user might copy. */
  mono?: boolean;
  as?: 'p' | 'span' | 'div';
  children?: ReactNode;
  className?: string;
}

/** Body copy at the app's three tones. */
export function Text({
  tone = 'secondary',
  size = 'md',
  mono = false,
  as = 'p',
  children,
  className,
}: TextProps) {
  return createElement(
    as,
    {
      className: cx(
        'mds-text',
        tone !== 'secondary' && `mds-text--${tone}`,
        size !== 'md' && `mds-text--${size}`,
        mono && 'mds-text--mono',
        className,
      ),
    },
    children,
  );
}

export interface EyebrowProps {
  children?: ReactNode;
  className?: string;
}

/** Uppercase mono kicker above a heading — the section marker in Analytics and Settings. */
export function Eyebrow({ children, className }: EyebrowProps) {
  return <div className={cx('mds-eyebrow', className)}>{children}</div>;
}

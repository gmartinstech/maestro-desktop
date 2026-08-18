import { createElement, type ReactNode } from 'react';
import { cx } from '../cx';

export interface HeadingProps {
  /** 1 = page title (24px), 2 = section (18px), 3 = card title (15px), 4 = label (13px). */
  level?: 1 | 2 | 3 | 4;
  /** Render a different tag than the level implies, to keep the document outline correct. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'div';
  children?: ReactNode;
  className?: string;
}

/** Titles at the four sizes the app uses. Sizing and semantics are separable via `as`. */
export function Heading({ level = 2, as, children, className }: HeadingProps) {
  return createElement(
    as ?? (`h${level}` as const),
    { className: cx('mds-heading', `mds-heading--${level}`, className) },
    children,
  );
}

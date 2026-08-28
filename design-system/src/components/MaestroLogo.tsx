import type { CSSProperties } from 'react';
import { cx } from '../cx';

export interface MaestroLogoProps {
  /** Hide the wordmark and show the glyph alone — what the collapsed sidebar rail uses. */
  markOnly?: boolean;
  /** Glyph edge in px. The wordmark scales with it. */
  size?: number;
  /** Product line the wordmark spells out. */
  product?: 'Maestro Studio' | 'MartinsConnect' | 'MartinsTech';
  className?: string;
  style?: CSSProperties;
}

/**
 * Brand lockup: a navy tile carrying the gold conductor glyph, with the product wordmark
 * beside it. In dark mode the tile inverts to gold with dark ink, matching the token layer.
 */
export function MaestroLogo({
  markOnly = false,
  size = 24,
  product = 'Maestro Studio',
  className,
  style,
}: MaestroLogoProps) {
  const [first, ...rest] = product.split(' ');
  return (
    <span
      className={cx('mds-logo', className)}
      style={{ fontSize: Math.round(size * 0.58), ...style }}
    >
      <span className="mds-logo__mark" style={{ width: size, height: size }}>
        <svg
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 12.5V3.5M8 12.5V6M14 12.5V5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!markOnly && (
        <span className="mds-logo__word">
          <b>{first}</b>
          {rest.length > 0 && <span> {rest.join(' ')}</span>}
        </span>
      )}
    </span>
  );
}

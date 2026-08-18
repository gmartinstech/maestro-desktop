import type { CSSProperties } from 'react';

// Monoline glyphs at 24x24 with a 1.75 stroke — the same drawing language as the app's
// lucide set, shipped inline so the bundle stays dependency-free.
const PATHS = {
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.5',
  warning: 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.5',
  error: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9 9l6 6M15 9l-6 6',
  success: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l2.5 2.5L16 9.5',
  settings:
    'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.9 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004.6 14H4.5a2 2 0 110-4h.1A1.6 1.6 0 006.3 8.6l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0011 4.6V4.5a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.1a2 2 0 110 4h-.1a1.6 1.6 0 00-1.2.9z',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  terminal: 'M5 6l6 6-6 6M13 18h6',
  tool: 'M14.7 6.3a4 4 0 015.3 5L20 11l-8.5 8.5a2.1 2.1 0 01-3-3L17 8z',
  workflow: 'M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v4.5a2 2 0 002 2H14',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  panelLeft: 'M4 4h16v16H4zM10 4v16',
  arrowLeft: 'M20 12H4M10 6l-6 6 6 6',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  send: 'M21 3L10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3z',
  play: 'M7 4.5l12 7.5-12 7.5z',
  pause: 'M9 4.5v15M15 4.5v15',
  stop: 'M6 6h12v12H6z',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  folder: 'M3 7a1 1 0 011-1h5l2 2.5h9a1 1 0 011 1V18a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  file: 'M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7zM14 3v4h4',
  bell: 'M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9zM10.5 20a2 2 0 003 0',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0',
  moon: 'M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z',
  sun: 'M12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v4h-4',
  agent: 'M8 4h8a2 2 0 012 2v3H6V6a2 2 0 012-2zM4 11h16v7a2 2 0 01-2 2H6a2 2 0 01-2-2zM9.5 15h.5M14 15h.5M12 2v2',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  /** Which glyph to draw. */
  name: IconName;
  /** Edge length in px. 16 in buttons and nav rows, 18-20 in headers, 24+ in empty states. */
  size?: number;
  /** Stroke colour. Defaults to `currentColor`, which is almost always what you want. */
  color?: string;
  /** Filled glyphs (play, stop) read better with stroke width 0 and a fill. */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The icon set. Monoline, 1.75 stroke, inheriting colour from its parent. */
export function Icon({ name, size = 16, color, filled = false, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color, flex: '0 0 auto', display: 'block', ...style }}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

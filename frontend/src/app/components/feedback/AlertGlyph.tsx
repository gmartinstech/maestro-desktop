import React from 'react';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

/** Warning/error glyph for inline notices. Colors come from status tokens so it tracks the theme. */
export const AlertGlyph: React.FC<{ size?: number; tone?: 'warning' | 'error' }> = ({ size = 22, tone = 'warning' }) => {
  const c = useClaudeTokens();
  // Stroke carries the shape; the tinted fill keeps it readable against both the card bg and the page.
  const stroke = tone === 'error' ? c.status.error : c.status.warning;
  const fill = tone === 'error' ? c.status.errorBg : c.status.warningBg;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="presentation" style={{ flexShrink: 0 }}>
      <path
        d="M12 3.4 21 19.2a1.4 1.4 0 0 1-1.2 2.1H4.2A1.4 1.4 0 0 1 3 19.2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <line x1="12" y1="9.4" x2="12" y2="14.4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1.05" fill={stroke} />
    </svg>
  );
};

export default AlertGlyph;

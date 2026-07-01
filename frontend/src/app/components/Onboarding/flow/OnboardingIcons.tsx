// Thin line icons + the brand spark, matching Claude onboarding's icon style. No emoji.

import React from 'react';
import type { IconName } from './onboardingFlowTypes';

const ICON_INNER: Record<IconName, React.ReactNode> = {
  work: (<><rect x={3} y={7.5} width={18} height={12} rx={2} /><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" /><path d="M3 13h18" /></>),
  home: (<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></>),
  build: (<><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>),
  mail: (<><rect x={3} y={5} width={18} height={14} rx={2} /><path d="m3 7 9 6 9-6" /></>),
  doc: (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  chat: (<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />),
  sun: (<><circle cx={12} cy={12} r={4} /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  tray: (<><path d="M3 12h4l2 3h6l2-3h4" /><path d="M5 6h14l2 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></>),
  globe: (<><circle cx={12} cy={12} r={9} /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></>),
};

export const LineIcon: React.FC<{ name: IconName; size?: number; strokeWidth?: number }> = ({
  name,
  size = 24,
  strokeWidth = 1.5,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {ICON_INNER[name]}
  </svg>
);

// Small shared UI atoms for the onboarding screens (serif heading, subtitle, white CTA, ghost link).

import React from 'react';
import { ONBOARDING_SKIN as S } from './onboardingSkin';

export const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 style={{ fontFamily: S.serif, fontWeight: 500, fontSize: 33, lineHeight: 1.15, letterSpacing: '-0.005em', color: S.text, margin: 0 }}>
    {children}
  </h1>
);

export const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ marginTop: 12, fontSize: 15, color: S.muted }}>{children}</div>
);

export const PrimaryButton: React.FC<{ onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }> = ({
  onClick,
  children,
  style,
}) => (
  <button
    onClick={onClick}
    style={{
      marginTop: 24,
      width: '100%',
      maxWidth: 430,
      background: S.ctaBg,
      color: S.ctaText,
      border: 'none',
      borderRadius: 11,
      padding: 14,
      fontFamily: S.sans,
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
      ...style,
    }}
  >
    {children}
  </button>
);

export const GhostLink: React.FC<{ onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }> = ({
  onClick,
  children,
  style,
}) => (
  <div
    onClick={onClick}
    style={{ marginTop: 26, color: S.muted, fontSize: 14, cursor: 'pointer', ...style }}
  >
    {children}
  </div>
);

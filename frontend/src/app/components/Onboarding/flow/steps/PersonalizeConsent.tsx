// D3: the personalize consent. One serif line types itself in, then a single Yes. "Yes" authorizes
// the (later) background profiling read; copy states that plainly. This is a permission, not a checkbox.

import React, { useEffect, useState } from 'react';
import { useReducedMotion } from '@/shared/hooks/useReducedMotion';
import { ONBOARDING_SKIN as S } from '../onboardingSkin';
import { PrimaryButton, GhostLink } from '../OnboardingAtoms';

const LINE =
  "Want me to actually get you? Say yes and I'll take a quick look at whatever you connect, so everything I show is aimed at your world, not a generic demo.";

export const PersonalizeConsent: React.FC<{ onConsent: (yes: boolean) => void }> = ({ onConsent }) => {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? LINE.length : 0);
  const done = shown >= LINE.length;

  useEffect(() => {
    if (reduce) { setShown(LINE.length); return; }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= LINE.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <>
      <div
        style={{
          fontFamily: S.serif,
          fontWeight: 500,
          fontSize: 29,
          lineHeight: 1.4,
          maxWidth: 620,
          minHeight: '4.4em',
          color: S.text,
        }}
      >
        {LINE.slice(0, shown)}
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: '1.02em',
            background: S.accent,
            marginLeft: 3,
            verticalAlign: -3,
            animation: reduce ? undefined : 'onboardingCaretBlink 1s steps(1) infinite',
          }}
        />
      </div>
      <div
        style={{
          marginTop: 14,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          opacity: done ? 1 : 0,
          transition: 'opacity .6s ease',
          pointerEvents: done ? 'auto' : 'none',
        }}
      >
        <PrimaryButton onClick={() => onConsent(true)}>Yes, get to know me</PrimaryButton>
        <GhostLink style={{ marginTop: 2 }} onClick={() => onConsent(false)}>not now</GhostLink>
      </div>
      <style>{'@keyframes onboardingCaretBlink{50%{opacity:0}}'}</style>
    </>
  );
};

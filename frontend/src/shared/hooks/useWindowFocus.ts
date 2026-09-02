// Reports app focus_lost/focus_gained from Electron blur/focus IPC; no-op in browser.

import { useEffect } from 'react';
import { report } from '@/shared/serviceClient';
import { shell, hasNativeShell } from '@/shared/shell';

interface FocusPayload {
  kind: 'blur' | 'focus';
  ts: number;
}

export function useWindowFocus(): void {
  useEffect(() => {
    if (!hasNativeShell) return;

    let lastBlurTs: number | null = null;
    let lastFocusTs: number | null = null;

    const unsubscribe = shell.onWindowFocus(({ kind, ts }: FocusPayload) => {
      if (kind === 'blur') {
        const elapsedMsSinceFocus = lastFocusTs !== null ? ts - lastFocusTs : null;
        report('app', 'focus_lost', {
          ms_since_last_focus: elapsedMsSinceFocus,
        });
        lastBlurTs = ts;
      } else {
        const elapsedMsAway = lastBlurTs !== null ? ts - lastBlurTs : null;
        report('app', 'focus_gained', {
          ms_away: elapsedMsAway,
        });
        lastFocusTs = ts;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);
}

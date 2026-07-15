import { useCallback, useRef, useState } from 'react';
import { useAppDispatch } from '@/shared/hooks';
import { updateSettingsPatch } from '@/shared/state/settingsSlice';
import { setFlowActive, stageReveal } from '@/shared/state/onboardingV3Slice';
import { useThemeAccent, useThemeMode } from '@/shared/styles/ThemeContext';
import {
  fetchIdentity, runPrep, runScan, summarizeScan,
  type PrepResponse, type ProviderIdentity, type ScanResult,
} from './onboardingV3Api';

// The curtain machinery: scan kicks off during the OAuth wait, prep during the theme beat, so by the reveal everything personal is already sitting in memory. Every stage fails soft; the flow never blocks on any of it.
export function useOnboardingV3Pipeline() {
  const dispatch = useAppDispatch();
  const { accent, gradient } = useThemeAccent();
  const { mode } = useThemeMode();
  const [identity, setIdentity] = useState<ProviderIdentity[]>([]);
  const identityRef = useRef<ProviderIdentity[]>([]);
  const scanRef = useRef<Promise<ScanResult | null> | null>(null);
  const prepRef = useRef<Promise<PrepResponse | null> | null>(null);
  const scanResultRef = useRef<ScanResult | null>(null);

  const kickIdentity = useCallback(() => {
    fetchIdentity().then((ids) => { identityRef.current = ids; setIdentity(ids); }).catch(() => {});
  }, []);

  const kickScan = useCallback((consented: boolean) => {
    if (scanRef.current) return;
    scanRef.current = consented
      ? runScan().then((r) => { scanResultRef.current = r; return r; }).catch(() => null)
      : Promise.resolve(null);
  }, []);

  const kickPrep = useCallback((pickedApps: string[]) => {
    if (prepRef.current) return;
    const scanPromise = scanRef.current ?? Promise.resolve(null);
    prepRef.current = scanPromise.then((scan) => runPrep(scan, pickedApps, identityRef.current)).catch(() => null);
  }, []);

  const finish = useCallback(async (outcome: 'done' | 'skipped') => {
    if (outcome === 'skipped') {
      dispatch(setFlowActive(false));
      dispatch(updateSettingsPatch({ onboarding_v3: 'skipped', accent_color: accent, accent_gradient: gradient, theme: mode }));
      return;
    }
    // Cap the wait so a slow aux call degrades to generic starters instead of a hung curtain.
    const timeout = new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 15000); });
    const prep = await Promise.race([prepRef.current ?? Promise.resolve(null), timeout]);
    const greeting = prep?.greeting?.trim() || null;
    const starters = prep?.starters ?? [];
    // Auto-run only a REAL prep result's first starter (the prompt contract makes it a read-only audit); the static fallback never auto-runs.
    const autoPrompt = greeting && starters.length > 0 ? starters[0].prompt : null;
    // Await the PATCH so personalized_greeting/starters are IN settings before the reveal seeds the welcome chat; the greeting stream snapshots settings at mount.
    try {
      await dispatch(updateSettingsPatch({
        onboarding_v3: 'done',
        accent_color: accent,
        accent_gradient: gradient,
        theme: mode,
        personalized_greeting: greeting,
        personalized_starters: starters,
      })).unwrap();
    } catch {}
    dispatch(stageReveal({ greeting, starters, scanSummary: summarizeScan(scanResultRef.current), autoPrompt }));
    dispatch(setFlowActive(false));
  }, [dispatch, accent, gradient, mode]);

  return { identity, kickIdentity, kickScan, kickPrep, finish };
}

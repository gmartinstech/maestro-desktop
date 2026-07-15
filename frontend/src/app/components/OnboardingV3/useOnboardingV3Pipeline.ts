import { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { updateSettingsPatch } from '@/shared/state/settingsSlice';
import { createDraftSession, launchAndSendFirstMessage, type AgentConfig } from '@/shared/state/agentsSlice';
import { hasModelConnected } from '@/app/components/Onboarding/steps/skipPredicates';
import { getLastDashboardId } from '@/shared/lastDashboardId';
import { setFlowActive, stageReveal, addPreppedJob } from '@/shared/state/onboardingV3Slice';
import { useThemeAccent, useThemeMode } from '@/shared/styles/ThemeContext';
import {
  fetchIdentity, runPrep, runScan, summarizeScan,
  type PrepResponse, type ProviderIdentity, type ScanResult,
} from './onboardingV3Api';

// The curtain machinery: scan kicks off during the OAuth wait, prep during the theme beat, and the moment prep resolves the audit AND the app build launch as REAL background agents, so the curtain lifts on work already in motion. Every stage fails soft; the flow never blocks on any of it.
export function useOnboardingV3Pipeline() {
  const dispatch = useAppDispatch();
  const { accent, gradient } = useThemeAccent();
  const { mode } = useThemeMode();
  const [identity, setIdentity] = useState<ProviderIdentity[]>([]);
  const identityRef = useRef<ProviderIdentity[]>([]);
  const scanRef = useRef<Promise<ScanResult | null> | null>(null);
  const prepRef = useRef<Promise<PrepResponse | null> | null>(null);
  const scanResultRef = useRef<ScanResult | null>(null);
  const connected = useAppSelector((s) => hasModelConnected(s));
  const model = useAppSelector((s) => s.settings.data.default_model);
  const launchCtxRef = useRef({ connected: false, model: 'sonnet' });
  launchCtxRef.current = { connected, model };
  const launchedRef = useRef(false);

  const kickIdentity = useCallback(() => {
    fetchIdentity().then((ids) => { identityRef.current = ids; setIdentity(ids); }).catch(() => {});
  }, []);

  const kickScan = useCallback((consented: boolean) => {
    if (scanRef.current) return;
    scanRef.current = consented
      ? runScan().then((r) => { scanResultRef.current = r; return r; }).catch(() => null)
      : Promise.resolve(null);
  }, []);

  // Fire one real background agent; the session exists in redux without a card until the reveal composes the canvas.
  const launchJob = useCallback((title: string, prompt: string, kind: 'audit' | 'app') => {
    const { model: liveModel } = launchCtxRef.current;
    const dashboardId = getLastDashboardId() ?? undefined;
    const config: AgentConfig = { name: title, model: liveModel, mode: 'agent', dashboard_id: dashboardId };
    const draftId = dispatch(createDraftSession({ mode: 'agent', model: liveModel, dashboardId: dashboardId ?? '', setActive: false })).payload.draftId;
    void dispatch(launchAndSendFirstMessage({ draftId, config, prompt, mode: 'agent', model: liveModel }))
      .then((action) => {
        if (launchAndSendFirstMessage.fulfilled.match(action)) {
          dispatch(addPreppedJob({ sessionId: action.payload.session.id, title, kind }));
        }
      })
      .catch(() => {});
  }, [dispatch]);

  const kickPrep = useCallback((pickedApps: string[]) => {
    if (prepRef.current) return;
    const scanPromise = scanRef.current ?? Promise.resolve(null);
    prepRef.current = scanPromise.then((scan) => runPrep(scan, pickedApps, identityRef.current)).catch(() => null);
    // Launch the prepped work MID-FLOW (theme/card beats cover the latency): audit + app build, gated to a real connected model so the fragile free trial never carries it.
    void prepRef.current.then((prep) => {
      if (launchedRef.current || !prep || !prep.greeting || !launchCtxRef.current.connected) return;
      launchedRef.current = true;
      if (prep.starters.length > 0) launchJob(prep.starters[0].title, prep.starters[0].prompt, 'audit');
      if (prep.app_title && prep.app_prompt) launchJob(prep.app_title, prep.app_prompt, 'app');
    });
  }, [launchJob]);

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
    // Jobs already launched mid-flow at prep-resolve; the reveal only composes the canvas.
    const autoPrompt = null;
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

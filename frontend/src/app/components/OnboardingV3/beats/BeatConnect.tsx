import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { API_BASE } from '@/shared/config';
import { fetchModels } from '@/shared/state/modelsSlice';
import { fetchSubscriptionStatus, markSubscriptionConnected } from '@/shared/state/subscriptionsSlice';
import { updateSettingsPatch } from '@/shared/state/settingsSlice';
import { hasFreeTrialActive, hasModelConnected } from '@/app/components/Onboarding/steps/skipPredicates';
import { SUBSCRIPTION_PROVIDERS } from '@/app/pages/Settings/sections/subscription/subscriptionProviders';
import { runConnectFlow } from '@/app/pages/Settings/sections/subscription/subscriptionConnect';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';
import type { ProviderIdentity } from '../onboardingV3Api';
import BeatShell from './BeatShell';

// The single ask of the whole flow, staged as Arc's import list: radio rows, no filler copy. Reuses the proven Settings connect flow verbatim; the scan disclosure is one quiet line, and the scan runs during the OAuth wait.
const BeatConnect: React.FC<{
  c: ClaudeTokens;
  identity: ProviderIdentity[];
  scanConsent: boolean;
  setScanConsent: (v: boolean) => void;
  onConnected: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ c, identity, scanConsent, setScanConsent, onConnected, onNext, onBack }) => {
  const dispatch = useAppDispatch();
  const connected = useAppSelector((s) => hasModelConnected(s));
  const freeTrial = useAppSelector((s) => hasFreeTrialActive(s));
  const [connecting, setConnecting] = useState<string | null>(null);
  const [userCode, setUserCode] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedOnce = useRef(false);

  useEffect(() => () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); }, []);

  useEffect(() => {
    if (connected && !connectedOnce.current) {
      connectedOnce.current = true;
      onConnected();
    }
  }, [connected, onConnected]);

  const handleConnect = useCallback(async (providerId: string) => {
    setConnecting(providerId);
    setUserCode('');
    try {
      const res = await fetch(`${API_BASE}/agents/subscriptions/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.detail ?? 'connect failed'));
      runConnectFlow({
        providerId,
        data,
        setConnecting,
        setUserCode,
        setPollTimer: (t) => { pollTimerRef.current = t; },
        fetchStatus: (opts) => dispatch(fetchSubscriptionStatus(opts)).unwrap(),
        refreshPickerModels: () => { dispatch(fetchModels()); },
        markConnected: (provider) => { dispatch(markSubscriptionConnected({ provider })); },
      });
    } catch {
      setConnecting(null);
    }
  }, [dispatch]);

  const saveKey = useCallback(() => {
    const v = keyDraft.trim();
    if (!v) return;
    const field = v.startsWith('sk-ant-') ? 'anthropic_api_key' : v.startsWith('sk-or-') ? 'openrouter_api_key' : v.startsWith('AIza') ? 'google_api_key' : 'openai_api_key';
    dispatch(updateSettingsPatch({ [field]: v }));
    setKeyDraft('');
  }, [keyDraft, dispatch]);

  const connectedIdentity = identity.length > 0 ? identity[0] : null;

  return (
    <BeatShell
      c={c}
      title="Connect your AI."
      body="Use the subscription you already pay for."
      nextLabel="Continue"
      onNext={onNext}
      onBack={onBack}
    >
      <div style={{ width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SUBSCRIPTION_PROVIDERS.map((p, i) => {
          const isThis = connecting === p.id;
          const filled = connected && isThis;
          return (
            <motion.button
              key={p.id}
              onClick={() => !connected && handleConnect(p.id)}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.1 + i * 0.08 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px 13px 16px', textAlign: 'left',
                borderRadius: c.radius.md, border: `1px solid ${filled ? c.accent.primary : c.border.medium}`,
                background: c.bg.surface, cursor: connected ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 999, flexShrink: 0, boxSizing: 'border-box',
                border: `2px solid ${filled ? c.accent.primary : c.border.strong}`,
                background: filled ? c.accent.primary : 'transparent',
                boxShadow: filled ? `inset 0 0 0 3px ${c.bg.surface}` : 'none',
              }} />
              <span style={{ flex: 1, fontSize: '1rem', fontWeight: 600, color: c.text.primary }}>
                {p.name}
                {isThis && !connected && <span style={{ marginLeft: 10, fontSize: '0.8rem', fontWeight: 400, color: c.text.tertiary }}>waiting for sign-in...</span>}
              </span>
              <span style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: `${p.color}26`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ width: 13, height: 13, borderRadius: 999, background: p.color }} />
              </span>
            </motion.button>
          );
        })}
        {userCode && !connected && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: '0.9rem', color: c.text.secondary }}>
            Your code: <strong style={{ fontFamily: c.font.mono, letterSpacing: '0.08em' }}>{userCode}</strong>
          </div>
        )}
        {connected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '4px 2px', fontSize: '0.9rem', fontWeight: 500, color: c.status.success }}>
            Connected{connectedIdentity?.email ? ` as ${connectedIdentity.email}` : ''}
            {connectedIdentity?.plan ? ` · ${connectedIdentity.label} ${connectedIdentity.plan}` : ''}
          </motion.div>
        )}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 8, cursor: 'pointer', fontSize: '0.82rem', color: c.text.tertiary, lineHeight: 1.5 }}>
          <button
            onClick={(e) => { e.preventDefault(); setScanConsent(!scanConsent); }}
            style={{
              width: 16, height: 16, marginTop: 2, borderRadius: 5, padding: 0, cursor: 'pointer', flexShrink: 0,
              border: `1.5px solid ${scanConsent ? c.accent.primary : c.border.strong}`,
              background: scanConsent ? c.accent.primary : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 120ms ease, border-color 120ms ease',
            }}
          >
            {scanConsent && <Check size={11} color="#fff" strokeWidth={3.2} />}
          </button>
          <span>Take a quick local look around to personalize my setup. Nothing leaves this Mac.</span>
        </label>
        <div style={{ display: 'flex', gap: 18, marginTop: 2 }}>
          <button onClick={() => setShowKeys(!showKeys)} style={{ border: 'none', background: 'transparent', padding: 0, color: c.text.ghost, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
            Use an API key instead
          </button>
          {freeTrial && !connected && (
            <button onClick={onNext} style={{ border: 'none', background: 'transparent', padding: 0, color: c.text.ghost, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
              Start free, connect later
            </button>
          )}
        </div>
        {showKeys && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Paste an Anthropic, OpenAI, Google, or OpenRouter key"
              style={{
                flex: 1, padding: '10px 12px', borderRadius: c.radius.sm, border: `1px solid ${c.border.medium}`,
                background: c.bg.surface, color: c.text.primary, fontSize: '0.85rem', fontFamily: c.font.mono,
              }}
            />
            <button onClick={saveKey} style={{ padding: '10px 16px', borderRadius: c.radius.sm, border: 'none', background: c.accent.primary, color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Save
            </button>
          </div>
        )}
      </div>
    </BeatShell>
  );
};

export default BeatConnect;

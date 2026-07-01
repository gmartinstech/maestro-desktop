// D4: optional connect. Reuses the REAL shared connector catalog (icons + metadata), the REAL
// connection state from toolsSlice, and the REAL startOAuth thunk. No hardcoded list, no fake toggle.

import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { INTEGRATIONS, Integration } from '@/shared/integrations/catalog';
import { fetchTools, startOAuth, ToolDefinition } from '@/shared/state/toolsSlice';
import { useOnboardingSkin } from '../onboardingSkin';
import { Heading, Sub, PrimaryButton, GhostLink } from '../OnboardingAtoms';

// The connectors most useful for the profiling payoff; drawn from the real catalog by id.
const SHOWN_IDS = ['google-workspace', 'notion', 'slack'];

function toolFor(integration: Integration, items: Record<string, ToolDefinition>): ToolDefinition | undefined {
  return Object.values(items).find((t) => t.name === integration.name);
}

const Row: React.FC<{ integration: Integration }> = ({ integration }) => {
  const S = useOnboardingSkin();
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.tools.items);
  const tool = toolFor(integration, items);
  const connected = tool?.auth_status === 'connected';

  const connect = async () => {
    try {
      const res = await dispatch(startOAuth(tool?.id ?? integration.id)).unwrap();
      if (res.auth_url) window.open(res.auth_url, '_blank');
    } catch { /* connect failed; leave as-is */ }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14, padding: '16px 18px', textAlign: 'left' }}>
      <span style={{ display: 'flex', width: 22, justifyContent: 'center' }}>{integration.icon}</span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{integration.name}</div>
        <div style={{ fontSize: 12.5, color: S.muted, marginTop: 2 }}>
          {connected && tool?.connected_account_email ? tool.connected_account_email : integration.description}
        </div>
      </div>
      <span
        onClick={connected ? undefined : connect}
        style={{
          marginLeft: 'auto',
          fontSize: 13,
          color: connected ? S.muted : S.text,
          background: connected ? 'transparent' : S.surfaceHover,
          border: `1px solid ${connected ? S.border : S.borderStrong}`,
          borderRadius: 999,
          padding: '6px 15px',
          cursor: connected ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {connected ? 'Connected' : 'Connect'}
      </span>
    </div>
  );
};

export const ConnectApps: React.FC<{ onContinue: () => void; onSkip: () => void }> = ({ onContinue, onSkip }) => {
  const dispatch = useAppDispatch();
  const shown = INTEGRATIONS.filter((i) => SHOWN_IDS.includes(i.id));

  // Load real connection state, and re-check when the user returns from the OAuth browser tab.
  useEffect(() => {
    dispatch(fetchTools());
    const onFocus = () => dispatch(fetchTools());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dispatch]);

  return (
    <>
      <Heading>Connect what I can work with</Heading>
      <Sub>optional, and I&#39;ll only ever read it to understand you</Sub>
      <div style={{ marginTop: 44, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 11 }}>
        {shown.map((i) => (
          <Row key={i.id} integration={i} />
        ))}
      </div>
      <PrimaryButton onClick={onContinue} style={{ maxWidth: 200 }}>Continue</PrimaryButton>
      <GhostLink onClick={onSkip}>skip for now</GhostLink>
    </>
  );
};

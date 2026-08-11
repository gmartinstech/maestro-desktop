import { useEffect } from 'react';
import { useAppDispatch } from '@/shared/hooks';
import { fetchTools } from '@/shared/state/toolsSlice';
import { API_BASE } from '@/shared/config';
import { report } from '@/shared/serviceClient';

/** Subscribe to maestro://oauth deep-links from Electron main; no-op in browser. */
export function useDeepLink(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const api = (window as any).maestro as MaestroAPI | undefined;
    if (!api) return;

    let unsubscribeOauth: (() => void) | undefined;
    if (api?.onOauthClaim) {
      unsubscribeOauth = api.onOauthClaim(async (rawUrl: string) => {
        try {
          // maestro://oauth/{provider}/complete?session_id=...&tool_id=...
          const url = new URL(rawUrl);
          if (url.host !== 'oauth' || !url.pathname.endsWith('/complete')) {
            console.warn('[deep-link] Unexpected oauth-claim URL:', rawUrl);
            return;
          }
          const sessionId = url.searchParams.get('session_id');
          const toolId = url.searchParams.get('tool_id');
          if (!sessionId || !toolId) {
            console.warn('[deep-link] Missing session_id or tool_id in', rawUrl);
            return;
          }

          report('oauth', 'deep_link_received', { provider: url.pathname.split('/')[1] || 'unknown' });

          const resp = await fetch(`${API_BASE}/tools/oauth/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, tool_id: toolId }),
          });
          if (!resp.ok) {
            const text = await resp.text();
            console.error('[deep-link] OAuth claim failed:', resp.status, text);
            report('oauth', 'claim_failed', { status: resp.status });
            return;
          }
          report('oauth', 'claim_succeeded');
          dispatch(fetchTools());
        } catch (e) {
          console.error('[deep-link] OAuth claim threw:', e);
        }
      });
    }

    return () => {
      unsubscribeOauth?.();
    };
  }, [dispatch]);
}

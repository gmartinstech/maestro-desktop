import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { store } from '@/shared/state/store';
import {
  suspendBrowserCard,
  resumeBrowserCard,
  type BrowserCardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import { getWebview } from '@/shared/browserRegistry';
import { getActivity } from '@/shared/browserCommandHandler';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

const SETTLE_MS = 800;
// Hysteresis: suspend only well past the edge, resume just past it, so a card
// sitting on the boundary never flaps between webview and snapshot.
const SUSPEND_MARGIN_PX = 320;
const RESUME_MARGIN_PX = 96;
const SNAPSHOT_MAX_W = 1024;

interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
  vpW: number;
  vpH: number;
}

function cardIntersectsViewport(card: BrowserCardPosition, vp: Viewport, marginPx: number): boolean {
  const m = marginPx / vp.zoom;
  const vx = -vp.panX / vp.zoom - m;
  const vy = -vp.panY / vp.zoom - m;
  const vw = vp.vpW / vp.zoom + 2 * m;
  const vh = vp.vpH / vp.zoom + 2 * m;
  return card.x < vx + vw && card.x + card.width > vx && card.y < vy + vh && card.y + card.height > vy;
}

function agentNeedsLive(browserId: string, card: BrowserCardPosition): boolean {
  if (getActivity(browserId)) return true;
  const state = store.getState();
  const glow = state.dashboardLayout.glowingBrowserCards[browserId];
  if (glow && !glow.fading) return true;
  const sessions = state.agents.sessions as Record<string, any>;
  for (const s of Object.values(sessions)) {
    if (s.browser_id === browserId && (s.status === 'running' || s.status === 'waiting_approval')) return true;
  }
  if (card.spawned_by) {
    const parent = sessions[card.spawned_by];
    if (parent && (parent.status === 'running' || parent.status === 'waiting_approval')) return true;
  }
  return false;
}

/**
 * Swaps off-screen, agent-idle webviews for static snapshots (freeing their
 * renderer processes) and wakes them when panned back into view. Agent-driven
 * cards are never touched; commands to a suspended card wake it via
 * browserCommandHandler's awaitWebview.
 */
export function useWebviewSuspend(
  browserCards: Record<string, BrowserCardPosition>,
  panX: number,
  panY: number,
  zoom: number,
  viewportRef: React.RefObject<HTMLDivElement>,
) {
  const dispatch = useAppDispatch();
  const suspended = useAppSelector((s) => s.dashboardLayout.suspendedBrowserCards);
  const vpRef = useRef<Viewport>({ panX, panY, zoom, vpW: 1200, vpH: 800 });

  useEffect(() => {
    if (!isElectron) return;
    const el = viewportRef.current;
    vpRef.current = {
      panX, panY, zoom,
      vpW: el ? el.clientWidth : 1200,
      vpH: el ? el.clientHeight : 800,
    };

    for (const id of Object.keys(suspended)) {
      const card = browserCards[id];
      if (card && cardIntersectsViewport(card, vpRef.current, RESUME_MARGIN_PX)) {
        dispatch(resumeBrowserCard(id));
      }
    }

    const timer = setTimeout(async () => {
      for (const [id, card] of Object.entries(browserCards)) {
        if (store.getState().dashboardLayout.suspendedBrowserCards[id]) continue;
        if (cardIntersectsViewport(card, vpRef.current, SUSPEND_MARGIN_PX)) continue;
        if (agentNeedsLive(id, card)) continue;
        const wv = getWebview(id, card.activeTabId);
        if (!wv) continue;
        try {
          if (wv.isLoading()) continue;
          const url = wv.getURL();
          if (!url || url === 'about:blank') continue;
          const image = await wv.capturePage();
          if (image.isEmpty()) continue;
          // The capture await yielded; conditions may have changed under us.
          if (cardIntersectsViewport(card, vpRef.current, SUSPEND_MARGIN_PX)) continue;
          if (agentNeedsLive(id, card)) continue;
          const dataUrl = image.getSize().width > SNAPSHOT_MAX_W
            ? image.resize({ width: SNAPSHOT_MAX_W, quality: 'good' }).toDataURL()
            : image.toDataURL();
          dispatch(suspendBrowserCard({ browserId: id, dataUrl }));
        } catch {
          // capture failed mid-teardown or mid-navigation; card just stays live
        }
      }
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [browserCards, suspended, panX, panY, zoom, viewportRef, dispatch]);
}

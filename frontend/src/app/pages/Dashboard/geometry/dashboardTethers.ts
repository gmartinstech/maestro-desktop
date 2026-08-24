import { useMemo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardPosition, BrowserCardPosition, ViewCardPosition, WorkflowCardPosition, WorkflowsHubPosition } from '@/shared/state/dashboardLayoutSlice';
import type { Workflow, OpenCard } from '@/shared/state/workflowsSlice';
import { EXPANDED_CARD_MIN_H } from '@/shared/state/dashboardLayoutSlice';
import type { AgentSession } from '@/shared/state/agentsSlice';
import type { Output } from '@/shared/state/outputsSlice';
import { buildCardTether, type CardTetherContext } from './tether/cardTetherBuilder';
import { buildWorkflowTethers } from './tether/workflowTethers';
import { elbowPath, type Tether } from './tether/tetherGeometry';

export type { Tether } from './tether/tetherGeometry';

interface GlowingAgentCard {
  sourceId: string;
  fading: boolean;
  sourceYRatio?: number;
  label?: string;
}

interface GlowingBrowserCard {
  sourceId: string;
  fading: boolean;
  label?: string;
}

interface LiveDragInfo {
  cardId: string;
  dx: number;
  dy: number;
}

interface UseTethersArgs {
  glowingAgentCards: Record<string, GlowingAgentCard>;
  glowingBrowserCards: Record<string, GlowingBrowserCard>;
  cards: Record<string, CardPosition>;
  browserCards: Record<string, BrowserCardPosition>;
  workflowCards: Record<string, WorkflowCardPosition>;
  workflowItems: Record<string, Workflow>;
  workflowOpenCards: Record<string, OpenCard>;
  viewCards: Record<string, ViewCardPosition>;
  outputs: Record<string, Output>;
  expandedSessionIds: string[];
  liveDragInfo: LiveDragInfo | null;
  measuredHeightsRef: RefObject<Record<string, number>>;
  measuredHeightsTick: number;
  sessionList: AgentSession[];
  workflowsHub: WorkflowsHubPosition | null;
  workflowsMonitorCard: WorkflowsHubPosition | null;
  workflowsMonitorLabel: string;
  /** Session id of the run the monitor is showing; its browser tethers to the monitor card, not a (suppressed) standalone agent card. */
  monitorRunSessionId: string | null;
}

export function useTethers({
  glowingAgentCards,
  glowingBrowserCards,
  cards,
  browserCards,
  workflowCards,
  workflowItems,
  workflowOpenCards,
  viewCards,
  outputs,
  expandedSessionIds,
  liveDragInfo,
  measuredHeightsRef,
  measuredHeightsTick,
  sessionList,
  workflowsHub,
  workflowsMonitorCard,
  workflowsMonitorLabel,
  monitorRunSessionId,
}: UseTethersArgs): Tether[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const sessionById = new Map(sessionList.map((s) => [s.id, s]));
    const cardTetherCtx: CardTetherContext = {
      sessionById,
      workflowsMonitorCard,
      monitorRunSessionId,
      workflowsHub,
      cards,
      liveDragInfo,
      measuredHeightsRef,
      expandedSessionIds,
    };
    const cardTether = (
      dst: { x: number; y: number; width: number; height: number } | undefined,
      dstId: string,
      sourceId: string,
      key: string,
      label: string,
      fading: boolean,
    ) => buildCardTether(cardTetherCtx, dst, dstId, sourceId, key, label, fading);

    const agentTethers = Object.entries(glowingAgentCards).map(([copyId, { sourceId, fading, label }]) => {
      const src = cards[sourceId];
      const dst = cards[copyId];
      if (!src || !dst) return null;

      let srcX = src.x, srcY = src.y;
      let dstX = dst.x, dstY = dst.y;
      if (liveDragInfo) {
        if (liveDragInfo.cardId === sourceId) { srcX += liveDragInfo.dx; srcY += liveDragInfo.dy; }
        if (liveDragInfo.cardId === copyId) { dstX += liveDragInfo.dx; dstY += liveDragInfo.dy; }
      }

      const srcMeasured = measuredHeightsRef.current![sourceId];
      const srcH = srcMeasured ?? (expandedSessionIds.includes(sourceId)
        ? Math.max(EXPANDED_CARD_MIN_H, src.height)
        : src.height);
      const dstMeasured = measuredHeightsRef.current![copyId];
      const dstH = dstMeasured ?? (expandedSessionIds.includes(copyId)
        ? Math.max(EXPANDED_CARD_MIN_H, dst.height)
        : dst.height);

      const x1 = srcX + src.width;
      const y1 = srcY + srcH * 0.54;
      const x2 = dstX;
      const y2 = dstY + dstH * (expandedSessionIds.includes(copyId) ? 0.54 : 0.79);
      const midX = x1 + (x2 - x1) / 2;
      const labelX = midX + (x2 - midX) * 0.15;
      const labelY = y2;

      return {
        key: copyId,
        path: elbowPath(x1, y1, x2, y2),
        labelX,
        labelY,
        label: label || '',
        fading,
      };
    }).filter(Boolean) as Tether[];

    const glowTethers = new Map<string, ReturnType<typeof cardTether>>();
    for (const [browserId, { sourceId, fading, label }] of Object.entries(glowingBrowserCards)) {
      const tether = cardTether(
        browserCards[browserId],
        browserId,
        sourceId,
        `browser-${browserId}`,
        label || '',
        fading,
      );
      if (tether) glowTethers.set(browserId, tether);
    }

    for (const s of sessionList) {
      if (s.mode !== 'browser-agent') continue;
      if (s.status !== 'running' && s.status !== 'waiting_approval') continue;
      if (!s.browser_id || !s.parent_session_id) continue;
      if (glowTethers.has(s.browser_id)) continue;
      // A browser docked below the hub keeps a "Browser" pointer so the link reads at a glance; the right-docked agent/run cases stay label-free (their glow already said it on spawn).
      const parent = sessionById.get(s.parent_session_id);
      const tether = cardTether(
        browserCards[s.browser_id],
        s.browser_id,
        s.parent_session_id,
        `browser-${s.browser_id}`,
        parent?.workflow_edit_id ? t('dashboard.tether.browser') : '',
        false,
      );
      if (tether) glowTethers.set(s.browser_id, tether);
    }

    const browserTethers = Array.from(glowTethers.values()).filter(Boolean) as Tether[];

    const workflowTethers = buildWorkflowTethers({
      workflowCards,
      cards,
      workflowItems,
      workflowOpenCards,
      liveDragInfo,
      measuredHeightsRef,
      expandedSessionIds,
      t,
    });

    // Run Monitor tether: the Workflows window to its spawned live-run card.
    const monitorTethers: Tether[] = [];
    if (workflowsHub && workflowsMonitorCard) {
      let hubX = workflowsHub.x, hubY = workflowsHub.y;
      let monX = workflowsMonitorCard.x, monY = workflowsMonitorCard.y;
      // Track live drag so the line follows the card in real time instead of snapping into place on drop (same mechanism as the agent->browser tether).
      if (liveDragInfo) {
        if (liveDragInfo.cardId === 'workflows-hub') { hubX += liveDragInfo.dx; hubY += liveDragInfo.dy; }
        if (liveDragInfo.cardId === 'workflows-monitor') { monX += liveDragInfo.dx; monY += liveDragInfo.dy; }
      }
      // The monitor always spawns directly right of the hub, so anchor at the hub's right edge and the monitor's left edge at the same 0.54 height the browser/agent tethers use. Keeps the window->monitor line at the identical vertical spot as the monitor->browser line.
      const a = { x: hubX + workflowsHub.width, y: hubY + workflowsHub.height * 0.54 };
      const b = { x: monX, y: monY + workflowsMonitorCard.height * 0.54 };
      const midX = a.x + (b.x - a.x) / 2;
      const midY = a.y + (b.y - a.y) / 2;
      // The label box is left-anchored at labelX (rect starts there and grows right), so shift left by half the text width to truly center it on the line.
      monitorTethers.push({
        key: 'workflows-monitor',
        path: elbowPath(a.x, a.y, b.x, b.y),
        labelX: midX - (workflowsMonitorLabel.length * 7.5) / 2,
        labelY: midY,
        label: workflowsMonitorLabel,
        fading: false,
      });
    }

    // Index outputs by their owning session so the per-session lookup below doesn't scan the whole outputs map for every view-builder chat.
    const outputsBySession = new Map<string, string[]>();
    for (const o of Object.values(outputs)) {
      if (!o.session_id) continue;
      const arr = outputsBySession.get(o.session_id);
      if (arr) arr.push(o.id); else outputsBySession.set(o.session_id, [o.id]);
    }

    const viewTethers: Tether[] = [];
    for (const s of sessionList) {
      if (s.mode !== 'view-builder') continue;
      if (s.status !== 'running' && s.status !== 'waiting_approval') continue;
      const outIds = outputsBySession.get(s.id);
      if (!outIds) continue;
      for (const outputId of outIds) {
        if (!viewCards[outputId]) continue;
        const vt = cardTether(
          viewCards[outputId],
          outputId,
          s.id,
          `view-${outputId}`,
          'Editing',
          false,
        );
        if (vt) viewTethers.push(vt);
      }
    }

    return [...agentTethers, ...browserTethers, ...workflowTethers, ...viewTethers, ...monitorTethers];
  // measuredHeightsTick re-runs the memo once ResizeObserver reports a new height after a collapse (the ref read is invisible to the dep checker). eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowingAgentCards, glowingBrowserCards, cards, browserCards, workflowCards, workflowItems, workflowOpenCards, viewCards, outputs, expandedSessionIds, liveDragInfo, measuredHeightsTick, sessionList, workflowsHub, workflowsMonitorCard, workflowsMonitorLabel, monitorRunSessionId, t]);
}

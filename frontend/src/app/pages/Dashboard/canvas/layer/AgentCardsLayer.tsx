import React, { type RefObject } from 'react';
import { AnimatePresence } from 'framer-motion';
import AgentCard from '../../cards/AgentCard';
import {
  EXPANDED_CARD_MIN_H,
  DEFAULT_CARD_W,
  GRID_GAP,
  type CardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import type { CardType, useDashboardSelection } from '../../hooks/state/useDashboardSelection';

type Selection = ReturnType<typeof useDashboardSelection>;
type SpawnOrigin = { x: number; y: number; type?: 'branch' };
type GlowingAgentCard = { sourceId: string; fading: boolean; sourceYRatio?: number; label?: string };
type Direction = 'left' | 'right' | 'up' | 'down';

interface AgentCardsLayerProps {
  cards: Record<string, CardPosition>;
  dashboardId: string;
  glowingAgentCards: Record<string, GlowingAgentCard>;
  expandedSessionIds: string[];
  selection: Selection;
  highlightedCardId: string | null;
  autoFocusSessionId: string | null;
  focusedCardId: string | null;
  multiDragDelta: { dx: number; dy: number } | null;
  shakeDirection: Direction | null;
  spawnOriginsRef: RefObject<Record<string, SpawnOrigin>>;
  revealSpawnedRef: RefObject<Set<string>>;
  measuredHeightsRef: RefObject<Record<string, number>>;
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  getViewportEl: () => HTMLDivElement | null;
  onCardSelect: (id: string, type: CardType, shiftKey: boolean) => void;
  onDragStart: (id: string, type: CardType) => void;
  onDragMove: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd: (dx: number, dy: number, didDrag: boolean) => void;
  onDoubleClick: (id: string, type: CardType) => void;
  onBringToFront: (id: string, type: CardType) => void;
  onBranch: (sourceSessionId: string, newSessionId: string) => void;
  onMeasuredHeight: (sessionId: string, height: number) => void;
}

const AgentCardsLayer: React.FC<AgentCardsLayerProps> = ({
  cards,
  dashboardId,
  glowingAgentCards,
  expandedSessionIds,
  selection,
  highlightedCardId,
  autoFocusSessionId,
  focusedCardId,
  multiDragDelta,
  shakeDirection,
  spawnOriginsRef,
  revealSpawnedRef,
  measuredHeightsRef,
  getCanvasState,
  getViewportEl,
  onCardSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
  onBringToFront,
  onBranch,
  onMeasuredHeight,
}) => {
  return (
    <AnimatePresence>
      {Object.values(cards).map((card) => {
        const sid = card.session_id;

        let origin = spawnOriginsRef.current![sid];
        if (origin) {
          delete spawnOriginsRef.current![sid];
        } else {
          const glow = glowingAgentCards[sid];
          if (glow && !revealSpawnedRef.current!.has(sid)) {
            revealSpawnedRef.current!.add(sid);
            const srcCard = cards[glow.sourceId];
            if (srcCard) {
              const srcH = measuredHeightsRef.current![glow.sourceId]
                ?? (expandedSessionIds.includes(glow.sourceId)
                  ? Math.max(EXPANDED_CARD_MIN_H, srcCard.height)
                  : srcCard.height);
              origin = {
                x: srcCard.x + srcCard.width,
                y: srcCard.y + srcH / 2,
                type: 'branch' as const,
              };
            }
          }
        }

        let exitTarget: { x: number; y: number } | undefined;
        const glow = glowingAgentCards[sid];
        if (glow) {
          const srcCard = cards[glow.sourceId];
          if (srcCard) {
            const srcH = measuredHeightsRef.current![glow.sourceId]
              ?? (expandedSessionIds.includes(glow.sourceId)
                ? Math.max(EXPANDED_CARD_MIN_H, srcCard.height)
                : srcCard.height);
            exitTarget = {
              x: srcCard.x + srcCard.width,
              y: srcCard.y + srcH / 2,
            };
          }
        }

        let snapColumn: { x: number; width: number } | undefined;
        if (glow) {
          const srcCard = cards[glow.sourceId];
          if (srcCard) {
            snapColumn = {
              x: srcCard.x + srcCard.width + GRID_GAP * 12,
              width: DEFAULT_CARD_W,
            };
          }
        }

        const isSel = selection.isSelected(sid);
        return (
          <AgentCard
            key={sid}
            sessionId={sid}
            expanded={expandedSessionIds.includes(sid)}
            getCanvasState={getCanvasState}
            getViewportEl={getViewportEl}
            dashboardId={dashboardId}
            spawnFrom={origin}
            exitTarget={exitTarget}
            isSelected={isSel}
            isHighlighted={highlightedCardId === sid}
            // Only selected cards need the live drag delta; passing it to everyone broke memo equality for unselected cards on every mouse-move during multi-drag.
            multiDragDelta={isSel ? multiDragDelta : null}
            onCardSelect={onCardSelect}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onBranch={onBranch}
            onMeasuredHeight={onMeasuredHeight}
            snapColumn={snapColumn}
            autoFocusInput={autoFocusSessionId === sid}
            onDoubleClick={onDoubleClick}
            onBringToFront={onBringToFront}
            shakeDirection={focusedCardId === sid ? shakeDirection : null}
          />
        );
      })}
    </AnimatePresence>
  );
};

export default AgentCardsLayer;

import React, { type RefObject } from 'react';
import DashboardViewCard from '../../cards/DashboardViewCard';
import BrowserCard from '../../cards/browser/BrowserCard';
import NoteCard from '../../cards/NoteCard';
import ElementCard from '../../cards/ElementCard';
import AgentCardsLayer from './AgentCardsLayer';
import WorkflowHubLayer from './WorkflowHubLayer';
import {
  type CardPosition,
  type ViewCardPosition,
  type BrowserCardPosition,
  type NotePosition,
  type WorkflowCardPosition,
  type WorkflowsHubPosition,
  type ElementPosition,
} from '@/shared/state/dashboardLayoutSlice';
import type { Output } from '@/shared/state/outputsSlice';
import type { CardType, useDashboardSelection } from '../../hooks/state/useDashboardSelection';

type Selection = ReturnType<typeof useDashboardSelection>;
type SpawnOrigin = { x: number; y: number; type?: 'branch' };
type GlowingAgentCard = { sourceId: string; fading: boolean; sourceYRatio?: number; label?: string };
type Direction = 'left' | 'right' | 'up' | 'down';

interface DashboardCardLayerProps {
  dashboardId: string;
  cards: Record<string, CardPosition>;
  viewCards: Record<string, ViewCardPosition>;
  browserCards: Record<string, BrowserCardPosition>;
  keepAliveBrowserCards: Record<string, BrowserCardPosition>;
  notes: Record<string, NotePosition>;
  elements: Record<string, ElementPosition>;
  workflowCards: Record<string, WorkflowCardPosition>;
  workflowsHub: WorkflowsHubPosition | null;
  outputs: Record<string, Output>;
  glowingAgentCards: Record<string, GlowingAgentCard>;
  expandedSessionIds: string[];
  zoom: number;
  panX: number;
  panY: number;
  cmdHeld: boolean;
  selection: Selection;
  highlightedCardId: string | null;
  autoFocusSessionId: string | null;
  focusedCardId: string | null;
  pendingFocusNoteId: string | null;
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

const DashboardCardLayer: React.FC<DashboardCardLayerProps> = ({
  dashboardId,
  cards,
  viewCards,
  browserCards,
  keepAliveBrowserCards,
  notes,
  elements,
  workflowCards,
  workflowsHub,
  outputs,
  glowingAgentCards,
  expandedSessionIds,
  zoom,
  panX,
  panY,
  cmdHeld,
  selection,
  highlightedCardId,
  autoFocusSessionId,
  focusedCardId,
  pendingFocusNoteId,
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
    <>
      <AgentCardsLayer
        cards={cards}
        glowingAgentCards={glowingAgentCards}
        expandedSessionIds={expandedSessionIds}
        selection={selection}
        highlightedCardId={highlightedCardId}
        autoFocusSessionId={autoFocusSessionId}
        focusedCardId={focusedCardId}
        multiDragDelta={multiDragDelta}
        shakeDirection={shakeDirection}
        spawnOriginsRef={spawnOriginsRef}
        revealSpawnedRef={revealSpawnedRef}
        measuredHeightsRef={measuredHeightsRef}
        getCanvasState={getCanvasState}
        onCardSelect={onCardSelect}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDoubleClick={onDoubleClick}
        onBringToFront={onBringToFront}
        onBranch={onBranch}
        onMeasuredHeight={onMeasuredHeight}
      />
      {Object.entries(viewCards).map(([cardKey, vc]) => {
        const output = outputs[vc.output_id];
        if (!output) return null;
        return (
          <DashboardViewCard
            key={`view-${cardKey}`}
            cardKey={cardKey}
            instance={vc.instance ?? 1}
            output={output}
            cardX={vc.x}
            cardY={vc.y}
            cardWidth={vc.width}
            cardHeight={vc.height}
            cardZOrder={vc.zOrder ?? 0}
            zoom={zoom}
            panX={panX}
            panY={panY}
            cmdHeld={cmdHeld}
            isSelected={selection.isSelected(cardKey)}
            isHighlighted={highlightedCardId === cardKey}
            multiDragDelta={multiDragDelta}
            getViewportEl={getViewportEl}
            onCardSelect={onCardSelect}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDoubleClick={onDoubleClick}
            onBringToFront={onBringToFront}
          />
        );
      })}
      {/* One map over active + keep-alive cards: a card switching from active to hidden keeps its key + tree slot, so React never remounts it (a remount = new webview = lost session). Cross-dashboard ones render keepAliveHidden. */}
      {Object.values({ ...browserCards, ...keepAliveBrowserCards }).map((bc) => (
        <BrowserCard
          key={`browser-${bc.browser_id}`}
          keepAliveHidden={!!bc.dashboard_id && bc.dashboard_id !== dashboardId}
          browserId={bc.browser_id}
          tabs={bc.tabs}
          activeTabId={bc.activeTabId}
          cardX={bc.x}
          cardY={bc.y}
          cardWidth={bc.width}
          cardHeight={bc.height}
          cardZOrder={bc.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          cmdHeld={cmdHeld}
          isSelected={selection.isSelected(bc.browser_id)}
          isHighlighted={highlightedCardId === bc.browser_id}
          multiDragDelta={multiDragDelta}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDoubleClick={onDoubleClick}
          onBringToFront={onBringToFront}
        />
      ))}
      {Object.values(notes).map((n) => (
        <NoteCard
          key={`note-${n.note_id}`}
          noteId={n.note_id}
          cardX={n.x}
          cardY={n.y}
          cardWidth={n.width}
          cardHeight={n.height}
          cardZOrder={n.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          cmdHeld={cmdHeld}
          content={n.content}
          color={n.color}
          isSelected={selection.isSelected(n.note_id)}
          isHighlighted={highlightedCardId === n.note_id}
          multiDragDelta={multiDragDelta}
          autoFocus={pendingFocusNoteId === n.note_id}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onBringToFront={onBringToFront}
        />
      ))}
      {Object.values(elements).map((el) => (
        <ElementCard
          key={`element-${el.element_id}`}
          elementId={el.element_id}
          kind={el.kind}
          title={el.title}
          cardX={el.x}
          cardY={el.y}
          cardWidth={el.width}
          cardHeight={el.height}
          cardZOrder={el.zOrder ?? 0}
          cmdHeld={cmdHeld}
          getCanvasState={getCanvasState}
          isSelected={selection.isSelected(el.element_id)}
          isHighlighted={highlightedCardId === el.element_id}
          multiDragDelta={selection.isSelected(el.element_id) ? multiDragDelta : null}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onBringToFront={onBringToFront}
        />
      ))}
      <WorkflowHubLayer
        workflowsHub={workflowsHub}
        zoom={zoom}
        panX={panX}
        panY={panY}
        selection={selection}
        highlightedCardId={highlightedCardId}
        multiDragDelta={multiDragDelta}
        onCardSelect={onCardSelect}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onBringToFront={onBringToFront}
      />
      {/* Marquee selection rectangle */}
      {selection.marquee && (
        <div
          style={{
            position: 'absolute',
            left: selection.marquee.x,
            top: selection.marquee.y,
            width: selection.marquee.width,
            height: selection.marquee.height,
            border: '1.5px dashed rgba(59, 130, 246, 0.6)',
            background: 'rgba(59, 130, 246, 0.08)',
            borderRadius: 2,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      )}
    </>
  );
};

export default React.memo(DashboardCardLayer);

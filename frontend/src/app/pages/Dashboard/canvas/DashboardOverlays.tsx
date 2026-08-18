import React, { type RefObject } from 'react';
import Box from '@mui/material/Box';
import DashboardToolbar from '../DashboardToolbar';
import CardSearchPalette from '../controls/CardSearchPalette';
import DirectionHints from '../controls/DirectionHints';
import WorkflowRunningToast from '@/app/pages/Workflows/WorkflowRunningToast';
import MissedRunsToast from '@/app/pages/Workflows/MissedRunsToast';
import ProviderHealthToast from '@/app/components/overlays/ProviderHealthToast';
import type { AgentSession } from '@/shared/state/agentsSlice';
import type {
  CardPosition,
  ViewCardPosition,
  BrowserCardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import type { useCanvasControls } from '../hooks/interaction/useCanvasControls';

type Canvas = ReturnType<typeof useCanvasControls>;
type Direction = 'left' | 'right' | 'up' | 'down';
type NeighborDirections = { left: boolean; right: boolean; up: boolean; down: boolean };

interface DashboardOverlaysProps {
  canvas: Canvas;
  dashboardId: string;
  sessions: Record<string, AgentSession>;
  cards: Record<string, CardPosition>;
  viewCards: Record<string, ViewCardPosition>;
  browserCards: Record<string, BrowserCardPosition>;
  focusedCardId: string | null;
  shakeDirection: Direction | null;
  neighborDirections: NeighborDirections;
  toolbarOpen: boolean;
  searchPaletteOpen: boolean;
  newAgentBounce: boolean;
  toolbarRef: RefObject<HTMLDivElement>;
  onNewAgent: () => void;
  onToolbarCancel: () => void;
  onToolbarSend: (...args: any[]) => void;
  onAddView: (outputId: string, opts?: { newInstance?: boolean }) => void;
  onHistoryResume: (sessionId: string) => void;
  onAddBrowser: () => void;
  onAddNote: () => void;
  onAddElement: () => void;
  onNewAgentBounceEnd: () => void;
  onSearchPaletteClose: () => void;
  toolbarPrefill?: string;
  toolbarPrefillMode?: string;
}

const DashboardOverlays: React.FC<DashboardOverlaysProps> = ({
  canvas,
  dashboardId,
  sessions,
  cards,
  viewCards,
  browserCards,
  focusedCardId,
  shakeDirection,
  neighborDirections,
  toolbarOpen,
  searchPaletteOpen,
  newAgentBounce,
  toolbarRef,
  onNewAgent,
  onToolbarCancel,
  onToolbarSend,
  onAddView,
  onHistoryResume,
  onAddBrowser,
  onAddNote,
  onAddElement,
  onNewAgentBounceEnd,
  onSearchPaletteClose,
  toolbarPrefill,
  toolbarPrefillMode,
}) => {
  return (
    <>
      {/* Floating bottom toolbar */}
      <Box sx={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
        <DashboardToolbar
          ref={toolbarRef}
          inputOpen={toolbarOpen}
          onNewAgent={onNewAgent}
          onCancel={onToolbarCancel}
          onSend={onToolbarSend}
          onAddView={onAddView}
          onHistoryResume={onHistoryResume}
          onAddBrowser={onAddBrowser}
          onAddNote={onAddNote}
          onAddElement={onAddElement}
          dashboardId={dashboardId}
          newAgentBounce={newAgentBounce}
          onNewAgentBounceEnd={onNewAgentBounceEnd}
          prefillPrompt={toolbarPrefill}
          prefillMode={toolbarPrefillMode}
        />
      </Box>

      {/* Arrow navigation hints when zoomed in on a card */}
      {focusedCardId && canvas.zoom >= 0.4 && (
        <DirectionHints
          hasLeft={neighborDirections.left}
          hasRight={neighborDirections.right}
          hasUp={neighborDirections.up}
          hasDown={neighborDirections.down}
          shakeDirection={shakeDirection}
        />
      )}

      {/* Card search palette (Cmd+F) */}
      <CardSearchPalette
        open={searchPaletteOpen}
        onClose={onSearchPaletteClose}
        onNavigate={(rect) => canvas.actions.fitToCards([rect], 1.15, true)}
        cards={cards}
        viewCards={viewCards}
        browserCards={browserCards}
        sessions={sessions}
      />

      {/* Scheduled-run nudge: "your {workflow} is running now" + jump-to-canvas */}
      <WorkflowRunningToast />

      {/* Launch nudge when scheduled runs elapsed while the app was closed */}
      <MissedRunsToast />

      {/* Launch nudge when a subscription login died while the app was closed */}
      <ProviderHealthToast />
    </>
  );
};

export default DashboardOverlays;

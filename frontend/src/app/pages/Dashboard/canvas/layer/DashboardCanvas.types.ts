import type { RefObject } from 'react';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';
import type { AgentSession } from '@/shared/state/agentsSlice';
import type {
  CardPosition,
  ViewCardPosition,
  BrowserCardPosition,
  NotePosition,
  WorkflowCardPosition,
  WorkflowsHubPosition,
  ElementPosition,
} from '@/shared/state/dashboardLayoutSlice';
import type { Output } from '@/shared/state/outputsSlice';
import type { CardType, useDashboardSelection } from '../../hooks/state/useDashboardSelection';
import type { useCanvasControls } from '../../hooks/interaction/pointer/useCanvasControls';
import type { Tether } from '../../geometry/dashboardTethers';

export type Selection = ReturnType<typeof useDashboardSelection>;
export type Canvas = ReturnType<typeof useCanvasControls>;
export type SpawnOrigin = { x: number; y: number; type?: 'branch' };
export type GlowingAgentCard = { sourceId: string; fading: boolean; sourceYRatio?: number; label?: string };
export type Direction = 'left' | 'right' | 'up' | 'down';
export type NeighborDirections = { left: boolean; right: boolean; up: boolean; down: boolean };

export interface DashboardCanvasProps {
  c: ClaudeTokens;
  dashboardId: string;
  dashboardName?: string;
  canvas: Canvas;
  selection: Selection;
  sessions: Record<string, AgentSession>;
  sessionList: AgentSession[];
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
  tethers: Tether[];
  highlightedCardId: string | null;
  autoFocusSessionId: string | null;
  focusedCardId: string | null;
  pendingFocusNoteId: string | null;
  multiDragDelta: { dx: number; dy: number } | null;
  shakeDirection: Direction | null;
  neighborDirections: NeighborDirections;
  toolbarOpen: boolean;
  searchPaletteOpen: boolean;
  newAgentBounce: boolean;
  toolbarRef: RefObject<HTMLDivElement>;
  spawnOriginsRef: RefObject<Record<string, SpawnOrigin>>;
  revealSpawnedRef: RefObject<Set<string>>;
  measuredHeightsRef: RefObject<Record<string, number>>;
  getCanvasState: () => { panX: number; panY: number; zoom: number };
  getViewportEl: () => HTMLDivElement | null;
  fullscreenCardId: string | null;
  onViewportMouseDown: (e: React.MouseEvent) => void;
  onViewportMouseMove: (e: React.MouseEvent) => void;
  onViewportMouseUp: (e: React.MouseEvent) => void;
  onViewportDoubleClick: (e: React.MouseEvent) => void;
  onCardSelect: (id: string, type: CardType, shiftKey: boolean) => void;
  onDragStart: (id: string, type: CardType) => void;
  onDragMove: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd: (dx: number, dy: number, didDrag: boolean) => void;
  onCardDoubleClick: (id: string, type: CardType) => void;
  onBringToFront: (id: string, type: CardType) => void;
  onBranch: (sourceSessionId: string, newSessionId: string) => void;
  onMeasuredHeight: (sessionId: string, height: number) => void;
  onHighlightCard: (cardId: string) => void;
  onNewAgent: () => void;
  onToolbarCancel: () => void;
  onToolbarSend: (...args: any[]) => void;
  onStarter: (prompt: string, mode?: string) => void;
  toolbarPrefill?: string;
  toolbarPrefillMode?: string;
  onAddView: (outputId: string, opts?: { newInstance?: boolean }) => void;
  onHistoryResume: (sessionId: string) => void;
  onAddBrowser: () => void;
  onAddNote: () => void;
  onAddElement: () => void;
  onNewAgentBounceEnd: () => void;
  onFitToView: () => void;
  onTidy: () => void;
  onSearchPaletteClose: () => void;
}

import React from 'react';
import WorkflowsAppCard from '@/app/pages/Workflows/app/cards/WorkflowsAppCard';
import RunMonitor from '@/app/pages/Workflows/app/cards/RunMonitor';
import { closeWorkflowMonitor, type WorkflowsHubPosition } from '@/shared/state/dashboardLayoutSlice';
import { useAppSelector, useAppDispatch } from '@/shared/hooks';
import type { CardType, useDashboardSelection } from '../../hooks/state/useDashboardSelection';

type Selection = ReturnType<typeof useDashboardSelection>;

interface WorkflowHubLayerProps {
  workflowsHub: WorkflowsHubPosition | null;
  zoom: number;
  panX: number;
  panY: number;
  selection: Selection;
  highlightedCardId: string | null;
  multiDragDelta: { dx: number; dy: number } | null;
  onCardSelect: (id: string, type: CardType, shiftKey: boolean) => void;
  onDragStart: (id: string, type: CardType) => void;
  onDragMove: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd: (dx: number, dy: number, didDrag: boolean) => void;
  onBringToFront: (id: string, type: CardType) => void;
}

const WorkflowHubLayer: React.FC<WorkflowHubLayerProps> = ({
  workflowsHub,
  zoom,
  panX,
  panY,
  selection,
  highlightedCardId,
  multiDragDelta,
  onCardSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onBringToFront,
}) => {
  const dispatch = useAppDispatch();
  const monitorCard = useAppSelector((s) => s.dashboardLayout.workflowsMonitorCard);
  const monitorWorkflowId = useAppSelector((s) => s.dashboardLayout.workflowsMonitorId);
  const monitorWorkflow = useAppSelector((s) => (monitorWorkflowId ? s.workflows.items[monitorWorkflowId] : undefined));
  // The monitor's workflow vanished (trashed/deleted) while open: tear the card + its tether down instead of leaving an orange line pointing at nothing.
  React.useEffect(() => {
    if (monitorCard && !monitorWorkflow) dispatch(closeWorkflowMonitor());
  }, [monitorCard, monitorWorkflow, dispatch]);

  return (
    <>
      {workflowsHub && (
        <WorkflowsAppCard
          cardX={workflowsHub.x}
          cardY={workflowsHub.y}
          cardWidth={workflowsHub.width}
          cardHeight={workflowsHub.height}
          cardZOrder={workflowsHub.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          isSelected={selection.isSelected('workflows-hub')}
          isHighlighted={highlightedCardId === 'workflows-hub'}
          multiDragDelta={selection.isSelected('workflows-hub') ? multiDragDelta : null}
          onCardSelect={onCardSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onBringToFront={onBringToFront}
        />
      )}
      {monitorCard && monitorWorkflow && (
        <RunMonitor
          workflow={monitorWorkflow}
          cardX={monitorCard.x}
          cardY={monitorCard.y}
          cardWidth={monitorCard.width}
          cardHeight={monitorCard.height}
          cardZOrder={monitorCard.zOrder ?? 0}
          zoom={zoom}
          panX={panX}
          panY={panY}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      )}
    </>
  );
};

export default WorkflowHubLayer;

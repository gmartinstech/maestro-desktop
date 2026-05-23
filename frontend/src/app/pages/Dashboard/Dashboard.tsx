import React from 'react';
import SelectionOverlay from '@/app/components/SelectionOverlay';
import { ElementSelectionProvider } from '@/app/components/ElementSelectionContext';
import { useDomElementSelector } from '@/app/components/useDomElementSelector';
import { useDashboardController } from './useDashboardController';
import DashboardCanvas from './canvas/DashboardCanvas';

const DashboardSelectionOverlay: React.FC = () => {
  const { overlay, dragRect, dragPreview } = useDomElementSelector();
  return <SelectionOverlay overlay={overlay} dragRect={dragRect} dragPreview={dragPreview} />;
};

interface DashboardProps {
  dashboardId: string;
  isActive?: boolean;
}

const DashboardInner: React.FC<DashboardProps> = ({ dashboardId, isActive = true }) => {
  const controller = useDashboardController(dashboardId, isActive);
  return (
    <>
      <DashboardSelectionOverlay />
      <DashboardCanvas {...controller} />
    </>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ dashboardId, isActive = true }) => (
  <ElementSelectionProvider>
    <DashboardInner dashboardId={dashboardId} isActive={isActive} />
  </ElementSelectionProvider>
);

export default Dashboard;

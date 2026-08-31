import { DashboardScreen } from '@martinstech/maestro-ds';

export const Default = () => (
  <div style={{ height: 700 }}>
    <DashboardScreen />
  </div>
);

export const Empty = () => (
  <div style={{ height: 700 }}>
    <DashboardScreen dashboardName="New dashboard" empty />
  </div>
);

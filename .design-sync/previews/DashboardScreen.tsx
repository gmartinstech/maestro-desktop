import { DashboardScreen } from '@martinstech/maestro-ds';

export const Default = () => (
  <div style={{ height: 620 }}>
    <DashboardScreen />
  </div>
);

export const Analytics = () => (
  <div style={{ height: 620 }}>
    <DashboardScreen
      title="Analytics"
      subtitle="Token spend and latency across every agent."
      activeNav="analytics"
      stats={[
        { label: 'Tokens (24h)', value: '1.24M', delta: '+18.0%', trend: 'up' },
        { label: 'Tool calls', value: '3,910', delta: '-4.4%', trend: 'flat' },
        { label: 'p95 latency', value: '6.2s', delta: '-11.0%', trend: 'up' },
        { label: 'Cost estimate', value: 'R$ 412', delta: '+9.1%', trend: 'down' },
      ]}
    />
  </div>
);

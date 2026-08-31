import { BrowserCard } from '@martinstech/maestro-ds';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', height: 460, background: 'var(--mds-bg-page)', borderRadius: 14 }}>{children}</div>
);

export const AgentDriven = () => (
  <Frame>
    <BrowserCard
      x={20}
      y={20}
      width={620}
      height={420}
      tabs={[{ title: 'GitHub · maestro-desktop', active: true }, { title: 'New tab' }]}
      url="github.com/gmartinstech/maestro-desktop/pull/12"
      agentActive
    />
  </Frame>
);

export const MultiTab = () => (
  <Frame>
    <BrowserCard
      x={20}
      y={20}
      width={620}
      height={420}
      tabs={[{ title: 'Google' }, { title: 'llm.martinstech.net', active: true }, { title: 'New tab', loading: true }]}
      url="llm.martinstech.net/v1/status"
      bodyLabel="Loading…"
    />
  </Frame>
);

export const Selected = () => (
  <Frame>
    <BrowserCard x={20} y={20} width={620} height={420} tabs={[{ title: 'Search', active: true }]} url="Search Google or enter URL..." secure={false} selected />
  </Frame>
);

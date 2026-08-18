import { ViewCard } from '@martinstech/maestro-ds';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', height: 420, background: 'var(--mds-bg-page)', borderRadius: 14 }}>{children}</div>
);

export const Preview = () => (
  <Frame>
    <ViewCard x={20} y={20} width={600} height={380} title="Release notes preview" instanceLabel="#1" bodyLabel="Generated app preview" />
  </Frame>
);

export const Code = () => (
  <Frame>
    <ViewCard x={20} y={20} width={600} height={380} title="Backlog triage tool" tab="code" bodyLabel="Source view" />
  </Frame>
);

export const Interactive = () => (
  <Frame>
    <ViewCard x={20} y={20} width={600} height={380} title="Doc sweep report" tab="terminal" bodyLabel="Terminal output" interactive />
  </Frame>
);

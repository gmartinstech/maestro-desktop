import { CanvasCardFrame } from '@martinstech/maestro-ds';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', height: 200, background: 'var(--mds-bg-page)', borderRadius: 14 }}>{children}</div>
);

export const States = () => (
  <Frame>
    <CanvasCardFrame x={16} y={16} width={200} height={140}>
      <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--mds-text-secondary)' }}>Default</div>
    </CanvasCardFrame>
    <CanvasCardFrame x={240} y={16} width={200} height={140} selected>
      <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--mds-text-secondary)' }}>Selected</div>
    </CanvasCardFrame>
    <CanvasCardFrame x={464} y={16} width={200} height={140} highlighted>
      <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--mds-text-secondary)' }}>Highlighted</div>
    </CanvasCardFrame>
  </Frame>
);

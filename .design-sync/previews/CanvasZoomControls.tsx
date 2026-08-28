import { CanvasZoomControls } from '@martinstech/maestro-ds';

export const Pill = () => (
  <div style={{ position: 'relative', height: 100, background: 'var(--mds-bg-page)', borderRadius: 14 }}>
    <CanvasZoomControls zoom={125} />
  </div>
);

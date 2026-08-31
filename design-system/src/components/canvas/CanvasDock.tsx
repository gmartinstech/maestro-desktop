import { Icon } from '../Icon';

/**
 * The floating bottom toolbar dock, ported from DashboardToolbar.tsx. Six 44x44 buttons;
 * "New Agent" is the one filled/accent button, the rest are ghost icon buttons.
 */
export function CanvasDock() {
  return (
    <div className="mds-canvas-dock">
      <div className="mds-canvas-dock__btn mds-canvas-dock__btn--primary">
        <Icon name="agent" size={18} />
        New Agent
      </div>
      <div className="mds-canvas-dock__btn">
        <Icon name="grid" size={20} />
      </div>
      <div className="mds-canvas-dock__btn">
        <Icon name="external" size={20} />
      </div>
      <div className="mds-canvas-dock__btn">
        <Icon name="workflow" size={20} />
      </div>
      <div className="mds-canvas-dock__btn">
        <Icon name="file" size={20} />
      </div>
      <div className="mds-canvas-dock__btn">
        <Icon name="clock" size={20} />
      </div>
    </div>
  );
}

/**
 * The zoom pill + minimap toggle, ported from CanvasControls.tsx.
 */
export function CanvasZoomControls({ zoom = 100 }: { zoom?: number }) {
  return (
    <div className="mds-canvas-zoom">
      <div className="mds-canvas-zoom__btn">
        <Icon name="minus" size={15} />
      </div>
      <span className="mds-canvas-zoom__label">{zoom}%</span>
      <div className="mds-canvas-zoom__btn">
        <Icon name="plus" size={15} />
      </div>
      <div className="mds-canvas-zoom__divider" />
      <div className="mds-canvas-zoom__btn">
        <Icon name="external" size={14} />
      </div>
      <div className="mds-canvas-zoom__btn">
        <Icon name="sparkle" size={14} />
      </div>
      <div className="mds-canvas-zoom__divider" />
      <div className="mds-canvas-zoom__btn">
        <Icon name="map" size={14} />
      </div>
    </div>
  );
}

import { Icon } from '../Icon';

const CATEGORIES: { label: string; icon: 'search' | 'tool' | 'external' | 'plus' }[] = [
  { label: 'Research', icon: 'search' },
  { label: 'Build an app', icon: 'tool' },
  { label: 'Use the web', icon: 'external' },
  { label: 'Connect your apps', icon: 'plus' },
];

/** The canvas's empty state, ported from DashboardEmptyState.tsx. */
export function CanvasEmptyState() {
  return (
    <div className="mds-canvas-empty">
      <div>
        <div className="mds-canvas-empty__prompt">What do you want done?</div>
        <div className="mds-canvas-empty__sub">pick one, or just tell me below</div>
      </div>
      <div className="mds-canvas-empty__categories">
        {CATEGORIES.map((c) => (
          <div key={c.label} className="mds-canvas-empty__category">
            <Icon name={c.icon} size={18} />
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

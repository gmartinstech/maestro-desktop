import { CanvasCardFrame } from './CanvasCardFrame';
import { Icon } from '../Icon';

export type ViewCardTab = 'preview' | 'code' | 'terminal' | 'history';

export interface ViewCardProps {
  x: number;
  y: number;
  /** 1280x800 is the app's spawn default. */
  width?: number;
  height?: number;
  title: string;
  instanceLabel?: string;
  tab?: ViewCardTab;
  bodyLabel?: string;
  selected?: boolean;
  interactive?: boolean;
}

const TABS: { id: ViewCardTab; icon: 'grid' | 'terminal' | 'file' | 'clock' }[] = [
  { id: 'preview', icon: 'grid' },
  { id: 'code', icon: 'file' },
  { id: 'terminal', icon: 'terminal' },
  { id: 'history', icon: 'clock' },
];

/**
 * A generated app / output card, ported from DashboardViewCard.tsx. The 4-way segmented
 * pill (Preview/Code/Terminal/History) is the header's defining feature; the header itself
 * collapses on idle in the real app, but is shown open here for clarity.
 */
export function ViewCard({
  x,
  y,
  width = 1280,
  height = 800,
  title,
  instanceLabel,
  tab = 'preview',
  bodyLabel,
  selected = false,
  interactive = false,
}: ViewCardProps) {
  return (
    <CanvasCardFrame x={x} y={y} width={width} height={height} selected={selected} highlighted={interactive}>
      <div className="mds-viewcard__header">
        <Icon name="grid" size={16} style={{ color: 'var(--mds-accent)' }} />
        <span className="mds-viewcard__title">{title}</span>
        {instanceLabel && (
          <span
            style={{
              fontSize: '0.66rem',
              fontWeight: 700,
              background: 'var(--mds-bg-page)',
              borderRadius: 999,
              padding: '1px 6px',
              color: 'var(--mds-text-tertiary)',
            }}
          >
            {instanceLabel}
          </span>
        )}
        <div className="mds-viewcard__segmented">
          {TABS.map((t) => (
            <div key={t.id} className={`mds-viewcard__segment${t.id === tab ? ' mds-viewcard__segment--active' : ''}`}>
              <Icon name={t.icon} size={14} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <Icon name="refresh" size={16} style={{ color: 'var(--mds-text-muted)' }} />
        <Icon name="plus" size={16} style={{ color: 'var(--mds-text-muted)' }} />
        <Icon name="x" size={16} style={{ color: 'var(--mds-text-ghost)' }} />
      </div>
      <div className="mds-viewcard__body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mds-text-ghost)', fontSize: '0.85rem' }}>
        {bodyLabel}
      </div>
    </CanvasCardFrame>
  );
}

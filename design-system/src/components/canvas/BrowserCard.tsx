import { CanvasCardFrame } from './CanvasCardFrame';
import { Icon } from '../Icon';

export interface BrowserTab {
  title: string;
  active?: boolean;
  loading?: boolean;
}

export interface BrowserCardProps {
  x: number;
  y: number;
  /** 1280x800 is the app's spawn default for browser and app/view cards. */
  width?: number;
  height?: number;
  tabs: BrowserTab[];
  url: string;
  secure?: boolean;
  bodyLabel?: string;
  agentActive?: boolean;
  selected?: boolean;
  highlighted?: boolean;
}

/**
 * A browser card, ported from BrowserCard.tsx. Only back/forward/reload live in the nav
 * bar — no home button, no hamburger. The tab strip doubles as the drag handle.
 */
export function BrowserCard({
  x,
  y,
  width = 1280,
  height = 800,
  tabs,
  url,
  secure = true,
  bodyLabel,
  agentActive = false,
  selected = false,
  highlighted = false,
}: BrowserCardProps) {
  return (
    <CanvasCardFrame x={x} y={y} width={width} height={height} selected={selected} highlighted={highlighted || agentActive}>
      <div className="mds-browsercard__tabstrip">
        {tabs.map((tab, i) => (
          <div key={i} className={`mds-browsercard__tab${tab.active ? ' mds-browsercard__tab--active' : ''}`}>
            <Icon name={tab.loading ? 'refresh' : 'grid'} size={12} />
            {tab.title}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {agentActive && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              margin: '5px 8px',
              padding: '2px 8px',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--mds-accent) 10%, transparent)',
              color: 'var(--mds-accent)',
              fontSize: '0.65rem',
              fontWeight: 600,
            }}
          >
            <Icon name="sparkle" size={11} />
            AI
          </span>
        )}
      </div>
      <div className="mds-browsercard__navbar">
        <Icon name="arrowLeft" size={15} style={{ color: 'var(--mds-text-muted)' }} />
        <Icon name="arrowRight" size={15} style={{ color: 'var(--mds-text-ghost)' }} />
        <Icon name="refresh" size={13} style={{ color: 'var(--mds-text-muted)' }} />
        <div className="mds-browsercard__urlbar">
          {secure ? <Icon name="lock" size={12} className="mds-browsercard__lock" /> : <Icon name="search" size={13} />}
          {url}
        </div>
      </div>
      <div className="mds-browsercard__body">{bodyLabel}</div>
    </CanvasCardFrame>
  );
}

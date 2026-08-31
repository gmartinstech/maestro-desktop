import { AppShell } from './AppShell';
import { TitleBar } from './TitleBar';
import { Sidebar, SidebarItem, SidebarSection } from './Sidebar';
import { MaestroLogo } from './MaestroLogo';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { CanvasDock, CanvasZoomControls } from './canvas/CanvasDock';
import { CanvasEmptyState } from './canvas/CanvasEmptyState';
import { AgentCard } from './canvas/AgentCard';
import { BrowserCard } from './canvas/BrowserCard';
import { NoteCard } from './canvas/NoteCard';

export interface DashboardScreenProps {
  dashboardName?: string;
  platform?: 'win' | 'mac';
  zoom?: number;
  /** Renders the canvas empty state (the app's real first-run screen) instead of cards. */
  empty?: boolean;
}

const RECENT_DASHBOARDS = ['Windows build', 'Release triage'];

/**
 * The app's actual home screen: a pan/zoom canvas holding absolutely-positioned agent,
 * browser, app and note cards over a dotted grid — not a KPI/stats page. Ported from
 * DashboardCanvas.tsx. This is the reference layout for the Dashboard route; the card
 * components it composes (AgentCard, BrowserCard, ViewCard, NoteCard) live in ./canvas
 * and are the pieces meant to be edited individually.
 */
export function DashboardScreen({ dashboardName = 'Windows build', platform = 'win', zoom = 100, empty = false }: DashboardScreenProps) {
  return (
    <AppShell
      flush
      titleBar={
        <TitleBar
          platform={platform}
          leading={<MaestroLogo size={22} />}
          title="Maestro Studio"
          nav={
            <>
              <IconButton icon={<Icon name="arrowLeft" />} label="Back" size="sm" />
              <IconButton icon={<Icon name="arrowRight" />} label="Forward" size="sm" />
            </>
          }
        />
      }
      sidebar={
        <Sidebar footer={<SidebarItem label="Settings" icon={<Icon name="settings" />} />}>
          <SidebarSection label="Dashboards" expanded>
            <SidebarItem label="Dashboards" icon={<Icon name="dashboard" />} />
            {RECENT_DASHBOARDS.map((d) => (
              <SidebarItem key={d} label={d} icon={<Icon name="dashboard" />} active={d === dashboardName} />
            ))}
          </SidebarSection>
          <SidebarItem label="Apps" icon={<Icon name="grid" />} />
        </Sidebar>
      }
    >
      <div className="mds-canvas">
        <div className="mds-canvas__dots" />
        <div className="mds-canvas__header-fade">
          <span className="mds-canvas__title-pill">{dashboardName}</span>
        </div>
        <div className="mds-canvas__viewport">
          {empty ? (
            <CanvasEmptyState />
          ) : (
            <>
              <AgentCard
                x={24}
                y={90}
                width={360}
                title="Release Notes"
                status="running"
                model="Claude Opus 5"
                elapsed="00:41"
                cost="$0.02"
                hasMemory
                preview="Reading electron/main.js…"
                selected
              />
              <BrowserCard
                x={410}
                y={90}
                width={340}
                height={230}
                tabs={[{ title: 'GitHub · maestro-desktop', active: true }, { title: 'New tab' }]}
                url="github.com/…/pull/12"
                agentActive
              />
              <AgentCard x={24} y={320} width={360} title="Backlog Triage" status="waiting on approval" approval={{ tool: 'label_issues', summary: 'Apply 12 labels across the open backlog.' }} />
              <NoteCard x={410} y={340} width={200} height={160} text="Ping Gabriel once the signature check is verified." color="yellow" />
            </>
          )}
        </div>
        <CanvasDock />
        <CanvasZoomControls zoom={zoom} />
      </div>
    </AppShell>
  );
}

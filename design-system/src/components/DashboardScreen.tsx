import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { TitleBar } from './TitleBar';
import { Sidebar, SidebarItem, SidebarSection } from './Sidebar';
import { PageHeader } from './PageHeader';
import { MaestroLogo } from './MaestroLogo';
import { StatCard } from './StatCard';
import { Card } from './Card';
import { Grid, Stack } from './Stack';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { Table, type TableColumn } from './Table';

export interface DashboardStat {
  label: string;
  value: string;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface DashboardRun {
  agent: string;
  workflow: string;
  status: 'running' | 'done' | 'failed';
  duration: string;
}

export interface DashboardScreenProps {
  title?: string;
  subtitle?: string;
  /** The KPI row. Four reads best; more wrap awkwardly. */
  stats?: DashboardStat[];
  /** Recent activity table. */
  runs?: DashboardRun[];
  /** Which nav row is lit. */
  activeNav?: string;
  platform?: 'win' | 'mac';
  /** Extra content dropped under the activity table. */
  children?: ReactNode;
}

const DEFAULT_STATS: DashboardStat[] = [
  { label: 'Active agents', value: '7', delta: '+2 today', trend: 'up' },
  { label: 'Runs (24h)', value: '184', delta: '+12.4%', trend: 'up' },
  { label: 'Avg duration', value: '48s', delta: '-6.1%', trend: 'up' },
  { label: 'Failures', value: '3', delta: '+1', trend: 'down' },
];

const DEFAULT_RUNS: DashboardRun[] = [
  { agent: 'Release Notes', workflow: 'summarise-commits', status: 'running', duration: '00:41' },
  { agent: 'Backlog Triage', workflow: 'label-issues', status: 'done', duration: '01:12' },
  { agent: 'Doc Sweep', workflow: 'link-check', status: 'done', duration: '00:26' },
  { agent: 'Nightly Build', workflow: 'verify-windows', status: 'failed', duration: '04:03' },
];

const STATUS_TONE = { running: 'info', done: 'success', failed: 'error' } as const;

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' as const },
  { id: 'agents', label: 'Agents', icon: 'agent' as const, count: 7 },
  { id: 'workflows', label: 'Workflows', icon: 'workflow' as const },
  { id: 'analytics', label: 'Analytics', icon: 'chart' as const },
];

const APPS = [
  { id: 'commands', label: 'Commands', icon: 'terminal' as const },
  { id: 'skills', label: 'Skills', icon: 'sparkle' as const },
  { id: 'tools', label: 'Tools', icon: 'tool' as const },
];

/**
 * Reference layout for the Dashboard route: KPI row above a recent-activity table,
 * inside the full desktop frame. Copy it as the starting point for any overview screen.
 */
export function DashboardScreen({
  title = 'Dashboard',
  subtitle = 'Everything your agents did today, in one place.',
  stats = DEFAULT_STATS,
  runs = DEFAULT_RUNS,
  activeNav = 'dashboard',
  platform = 'win',
  children,
}: DashboardScreenProps) {
  const columns: TableColumn<DashboardRun>[] = [
    { key: 'agent', header: 'Agent', render: (r) => <span className="mds-table__name">{r.agent}</span> },
    { key: 'workflow', header: 'Workflow', render: (r) => <span className="mds-mono">{r.workflow}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {r.status}
        </Badge>
      ),
    },
    { key: 'duration', header: 'Duration', numeric: true, render: (r) => r.duration },
  ];
  return (
    <AppShell
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
          actions={
            <>
              <IconButton icon={<Icon name="search" />} label="Search" size="sm" />
              <IconButton icon={<Icon name="bell" />} label="Notifications" size="sm" dot />
            </>
          }
        />
      }
      sidebar={
        <Sidebar
          footer={<SidebarItem label="Settings" icon={<Icon name="settings" />} />}
        >
          {NAV.map((n) => (
            <SidebarItem
              key={n.id}
              label={n.label}
              icon={<Icon name={n.icon} />}
              count={n.count}
              active={n.id === activeNav}
            />
          ))}
          <SidebarSection label="Apps">
            {APPS.map((a) => (
              <SidebarItem
                key={a.id}
                label={a.label}
                icon={<Icon name={a.icon} />}
                active={a.id === activeNav}
              />
            ))}
          </SidebarSection>
        </Sidebar>
      }
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="secondary" icon={<Icon name="refresh" />}>
              Refresh
            </Button>
            <Button icon={<Icon name="plus" />}>New agent</Button>
          </>
        }
      />
      <Stack gap={5}>
        <Grid columns={4}>
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} delta={s.delta} trend={s.trend} />
          ))}
        </Grid>
        <Card title="Recent runs" subtitle="Last 24 hours" padding="flush">
          <Table columns={columns} rows={runs} rowKey={(r) => r.agent} />
        </Card>
        {children}
      </Stack>
    </AppShell>
  );
}

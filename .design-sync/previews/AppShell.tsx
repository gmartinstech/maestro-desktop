import {
  AppShell,
  Button,
  Grid,
  Icon,
  IconButton,
  MaestroLogo,
  PageHeader,
  Sidebar,
  SidebarItem,
  StatCard,
  TitleBar,
  Toast,
} from '@martinstech/maestro-ds';

const Bar = () => (
  <TitleBar
    platform="win"
    leading={<MaestroLogo size={22} />}
    title="Maestro Studio"
    actions={<IconButton icon={<Icon name="search" />} label="Search" size="sm" />}
  />
);

const Rail = ({ collapsed = false }: { collapsed?: boolean }) => (
  <Sidebar collapsed={collapsed}>
    <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} collapsed={collapsed} active />
    <SidebarItem label="Agents" icon={<Icon name="agent" />} collapsed={collapsed} count={7} />
    <SidebarItem label="Workflows" icon={<Icon name="workflow" />} collapsed={collapsed} />
  </Sidebar>
);

export const Standard = () => (
  <div style={{ height: 440 }}>
    <AppShell titleBar={<Bar />} sidebar={<Rail />}>
      <PageHeader
        title="Dashboard"
        subtitle="Everything your agents did today."
        actions={<Button icon={<Icon name="plus" size={15} />}>New agent</Button>}
      />
      <Grid columns={3}>
        <StatCard label="Active agents" value="7" delta="+2 today" trend="up" />
        <StatCard label="Runs (24h)" value="184" delta="+12.4%" trend="up" />
        <StatCard label="Failures" value="3" delta="+1" trend="down" />
      </Grid>
    </AppShell>
  </div>
);

export const CollapsedRail = () => (
  <div style={{ height: 440 }}>
    <AppShell titleBar={<Bar />} sidebar={<Rail collapsed />}>
      <PageHeader title="Agents" subtitle="Seven agents are configured on this machine." />
    </AppShell>
  </div>
);

export const WithToast = () => (
  <div style={{ height: 440 }}>
    <AppShell
      titleBar={<Bar />}
      sidebar={<Rail />}
      toasts={<Toast tone="success" message="Workflow finished in 48s" actionLabel="View run" />}
    >
      <PageHeader title="Dashboard" subtitle="Toasts float above the content pane." />
    </AppShell>
  </div>
);

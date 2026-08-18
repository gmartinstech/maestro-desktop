import { Icon, Sidebar, SidebarItem, SidebarSection, Stack } from '@martinstech/maestro-ds';

export const Expanded = () => (
  <div style={{ height: 380, display: 'flex' }}>
    <Sidebar footer={<SidebarItem label="Settings" icon={<Icon name="settings" />} />}>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} count={7} />
      <SidebarItem label="Workflows" icon={<Icon name="workflow" />} />
      <SidebarItem label="Analytics" icon={<Icon name="chart" />} />
      <SidebarSection label="Apps">
        <SidebarItem label="Commands" icon={<Icon name="terminal" />} />
        <SidebarItem label="Skills" icon={<Icon name="sparkle" />} />
        <SidebarItem label="Tools" icon={<Icon name="tool" />} count={12} />
      </SidebarSection>
    </Sidebar>
  </div>
);

export const Collapsed = () => (
  <div style={{ height: 380, display: 'flex' }}>
    <Sidebar collapsed footer={<SidebarItem label="Settings" icon={<Icon name="settings" />} collapsed />}>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} collapsed active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} collapsed />
      <SidebarItem label="Workflows" icon={<Icon name="workflow" />} collapsed />
      <SidebarItem label="Analytics" icon={<Icon name="chart" />} collapsed />
    </Sidebar>
  </div>
);

export const BothWidths = () => (
  <Stack direction="row" gap={4} style={{ height: 380 }}>
    <Sidebar collapsed>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} collapsed active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} collapsed />
    </Sidebar>
    <Sidebar width={200}>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} count={7} />
    </Sidebar>
  </Stack>
);

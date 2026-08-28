import { Icon, Sidebar, SidebarItem } from '@martinstech/maestro-ds';

export const States = () => (
  <div style={{ display: 'flex', height: 240 }}>
    <Sidebar>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} />
      <SidebarItem label="Workflows" icon={<Icon name="workflow" />} count={4} />
      <SidebarItem label="Tools" icon={<Icon name="tool" />} count={12} />
    </Sidebar>
  </div>
);

export const ActiveWithCount = () => (
  <div style={{ display: 'flex', height: 160 }}>
    <Sidebar>
      <SidebarItem label="Agents" icon={<Icon name="agent" />} count={7} active />
      <SidebarItem label="Analytics" icon={<Icon name="chart" />} />
    </Sidebar>
  </div>
);

export const CollapsedRail = () => (
  <div style={{ display: 'flex', height: 200 }}>
    <Sidebar collapsed>
      <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} collapsed active />
      <SidebarItem label="Agents" icon={<Icon name="agent" />} collapsed />
      <SidebarItem label="Tools" icon={<Icon name="tool" />} collapsed />
    </Sidebar>
  </div>
);

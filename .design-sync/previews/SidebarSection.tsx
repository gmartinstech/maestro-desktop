import { Icon, Sidebar, SidebarItem, SidebarSection } from '@martinstech/maestro-ds';

export const Expanded = () => (
  <div style={{ display: 'flex', height: 300 }}>
    <Sidebar>
      <SidebarSection label="Dashboards" expanded>
        <SidebarItem label="Overview" icon={<Icon name="dashboard" />} active />
        <SidebarItem label="Windows build" icon={<Icon name="dashboard" />} />
      </SidebarSection>
      <SidebarSection label="Apps" expanded>
        <SidebarItem label="Commands" icon={<Icon name="terminal" />} />
        <SidebarItem label="Skills" icon={<Icon name="sparkle" />} />
        <SidebarItem label="Tools" icon={<Icon name="tool" />} count={12} />
      </SidebarSection>
    </Sidebar>
  </div>
);

export const Collapsed = () => (
  <div style={{ display: 'flex', height: 240 }}>
    <Sidebar>
      <SidebarSection label="Dashboards" expanded={false}>
        <SidebarItem label="Overview" icon={<Icon name="dashboard" />} />
      </SidebarSection>
      <SidebarSection label="Apps" expanded>
        <SidebarItem label="Commands" icon={<Icon name="terminal" />} />
        <SidebarItem label="Tools" icon={<Icon name="tool" />} count={12} />
      </SidebarSection>
    </Sidebar>
  </div>
);

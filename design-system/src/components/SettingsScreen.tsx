import { useState } from 'react';
import { AppShell } from './AppShell';
import { TitleBar } from './TitleBar';
import { Sidebar, SidebarItem } from './Sidebar';
import { PageHeader } from './PageHeader';
import { MaestroLogo } from './MaestroLogo';
import { Card } from './Card';
import { Stack } from './Stack';
import { Button } from './Button';
import { Tabs } from './Tabs';
import { Input } from './Input';
import { Select } from './Select';
import { SwitchRow } from './Switch';
import { Divider } from './Divider';
import { Alert } from './Alert';
import { Icon } from './Icon';

export interface SettingsScreenProps {
  /** Which settings tab is open. */
  section?: 'general' | 'provider' | 'appearance' | 'advanced';
  platform?: 'win' | 'mac';
  /** Endpoint shown in the provider field. */
  providerUrl?: string;
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'provider', label: 'Provider' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'advanced', label: 'Advanced' },
];

/**
 * Reference layout for Settings: a tabbed panel of grouped setting rows with a sticky
 * save action. Switch rows apply instantly; anything needing a Save goes in a form Card.
 */
export function SettingsScreen({
  section = 'provider',
  platform = 'win',
  providerUrl = 'https://llm.martinstech.net/v1',
}: SettingsScreenProps) {
  const [tab, setTab] = useState(section);
  const [telemetry, setTelemetry] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  return (
    <AppShell
      titleBar={
        <TitleBar platform={platform} leading={<MaestroLogo size={22} />} title="Maestro Studio" />
      }
      sidebar={
        <Sidebar>
          <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} />
          <SidebarItem label="Agents" icon={<Icon name="agent" />} count={7} />
          <SidebarItem label="Workflows" icon={<Icon name="workflow" />} />
          <SidebarItem label="Settings" icon={<Icon name="settings" />} active />
        </Sidebar>
      }
    >
      <PageHeader
        title="Settings"
        breadcrumbs={['Maestro Studio', 'Settings']}
        subtitle="Model routing, appearance and update behaviour for this machine."
        actions={<Button>Save changes</Button>}
      />
      <Stack gap={5} style={{ maxWidth: 720 }}>
        <Tabs items={TABS} value={tab} onChange={(id) => setTab(id as typeof tab)} />
        {tab === 'provider' && (
          <Card title="Model provider" subtitle="Where agent turns are routed.">
            <Stack gap={4}>
              <Input
                id="provider-url"
                label="Endpoint"
                defaultValue={providerUrl}
                mono
                hint="All model traffic goes through provedor-ia."
              />
              <Select
                id="provider-model"
                label="Default model"
                options={[
                  { value: 'opus', label: 'Claude Opus 5' },
                  { value: 'sonnet', label: 'Claude Sonnet 5' },
                  { value: 'haiku', label: 'Claude Haiku 4.5' },
                ]}
                defaultValue="sonnet"
              />
              <Alert tone="success" title="Connection verified">
                Reached the provider 2 minutes ago.
              </Alert>
            </Stack>
          </Card>
        )}
        {tab === 'general' && (
          <Card title="Workspace" subtitle="Where Maestro keeps agents and run records.">
            <Stack gap={4}>
              <Input id="ws-dir" label="Workspace folder" defaultValue={'C:\\Users\\gabriel\\maestro'} mono />
              <Select
                id="ws-start"
                label="On launch"
                options={[
                  { value: 'last', label: 'Reopen the last dashboard' },
                  { value: 'home', label: 'Start on the dashboard list' },
                ]}
                defaultValue="last"
              />
              <SwitchRow
                label="Start minimised to the tray"
                description="Maestro keeps running scheduled workflows in the background."
                checked={autoUpdate}
                onChange={setAutoUpdate}
              />
            </Stack>
          </Card>
        )}
        {tab === 'appearance' && (
          <Card title="Appearance" subtitle="Applies to this machine only.">
            <Stack gap={4}>
              <Select
                id="ap-theme"
                label="Theme"
                options={[
                  { value: 'system', label: 'Match system' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                defaultValue="system"
              />
              <Divider />
              <SwitchRow
                label="Reduce motion"
                description="Disable panel and toast animations."
                checked={reducedMotion}
                onChange={setReducedMotion}
              />
            </Stack>
          </Card>
        )}
        {tab === 'advanced' && (
          <Card title="Advanced" subtitle="Change these only if you know why.">
            <Stack gap={4}>
              <Alert tone="warning" title="These settings affect every agent">
                A bad concurrency limit can starve scheduled runs.
              </Alert>
              <Input id="adv-conc" label="Max concurrent runs" defaultValue="4" mono />
              <Divider />
              <SwitchRow
                label="Share anonymous usage data"
                description="Off by default. Maestro Studio never calls home."
                checked={telemetry}
                onChange={setTelemetry}
              />
            </Stack>
          </Card>
        )}
        <Card title="Updates">
          <SwitchRow
            label="Install updates automatically"
            description="Download in the background and apply on next launch."
            checked={autoUpdate}
            onChange={setAutoUpdate}
          />
        </Card>
      </Stack>
    </AppShell>
  );
}

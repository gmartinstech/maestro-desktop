import { Icon, Stack, Tabs, Text } from '@martinstech/maestro-ds';

export const Basic = () => (
  <Tabs
    value="general"
    items={[
      { id: 'general', label: 'General' },
      { id: 'provider', label: 'Provider' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'advanced', label: 'Advanced' },
    ]}
  />
);

export const WithCounts = () => (
  <Tabs
    value="runs"
    items={[
      { id: 'overview', label: 'Overview' },
      { id: 'runs', label: 'Runs', count: 184 },
      { id: 'failures', label: 'Failures', count: 3 },
      { id: 'archived', label: 'Archived', count: 0, disabled: true },
    ]}
  />
);

export const WithIcons = () => (
  <Stack gap={4}>
    <Tabs
      value="tools"
      items={[
        { id: 'agents', label: 'Agents', icon: <Icon name="agent" size={14} /> },
        { id: 'tools', label: 'Tools', icon: <Icon name="tool" size={14} />, count: 12 },
        { id: 'skills', label: 'Skills', icon: <Icon name="sparkle" size={14} /> },
      ]}
    />
    <Text tone="muted" size="sm">
      The active tab carries the accent rule, colour and weight.
    </Text>
  </Stack>
);

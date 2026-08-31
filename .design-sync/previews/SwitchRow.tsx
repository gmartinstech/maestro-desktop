import { Card, Divider, Stack, SwitchRow } from '@martinstech/maestro-ds';

export const SettingsGroup = () => (
  <Card title="Application" style={{ maxWidth: 520 }}>
    <Stack gap={3}>
      <SwitchRow
        checked
        label="Install updates automatically"
        description="Download in the background and apply on next launch."
      />
      <Divider />
      <SwitchRow
        checked={false}
        label="Reduce motion"
        description="Disable panel and toast animations."
      />
      <Divider />
      <SwitchRow
        checked={false}
        label="Share anonymous usage data"
        description="Off by default. Maestro Studio never calls home."
      />
    </Stack>
  </Card>
);

export const Single = () => (
  <Stack style={{ maxWidth: 460 }}>
    <SwitchRow checked label="Start minimised to the tray" />
  </Stack>
);

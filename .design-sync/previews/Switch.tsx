import { Stack, Switch, Text } from '@martinstech/maestro-ds';

export const States = () => (
  <Stack direction="row" gap={4} align="center">
    <Switch checked label="On" />
    <Switch checked={false} label="Off" />
    <Switch checked disabled label="On, locked" />
    <Switch checked={false} disabled label="Off, locked" />
    <Text tone="muted" size="sm">
      on · off · locked
    </Text>
  </Stack>
);

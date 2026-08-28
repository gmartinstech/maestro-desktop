import { Card, Spinner, Stack, Text } from '@martinstech/maestro-ds';

export const Sizes = () => (
  <Stack direction="row" gap={4} align="center">
    <Spinner size="sm" />
    <Spinner size="md" />
    <Spinner size="lg" />
  </Stack>
);

export const InPanel = () => (
  <Card title="Starting agent">
    <Stack direction="row" gap={3} align="center">
      <Spinner />
      <Text>Provisioning the run environment…</Text>
    </Stack>
  </Card>
);

import { Button, Divider, Stack, Text } from '@martinstech/maestro-ds';

export const Horizontal = () => (
  <Stack gap={3}>
    <Text tone="primary">Install updates automatically</Text>
    <Divider />
    <Text tone="primary">Reduce motion</Text>
    <Divider />
    <Text tone="primary">Share anonymous usage data</Text>
  </Stack>
);

export const Labelled = () => (
  <Stack gap={3}>
    <Button block>Continue with MartinsTech SSO</Button>
    <Divider label="or" />
    <Button variant="secondary" block>
      Use an API key
    </Button>
  </Stack>
);

export const Vertical = () => (
  <Stack direction="row" gap={3} align="center" style={{ height: 32 }}>
    <Text tone="muted" size="sm">
      184 runs
    </Text>
    <Divider orientation="vertical" />
    <Text tone="muted" size="sm">
      48s average
    </Text>
    <Divider orientation="vertical" />
    <Text tone="muted" size="sm">
      3 failures
    </Text>
  </Stack>
);

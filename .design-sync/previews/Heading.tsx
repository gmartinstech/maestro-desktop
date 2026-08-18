import { Heading, Stack, Text } from '@martinstech/maestro-ds';

export const Levels = () => (
  <Stack gap={3}>
    <Heading level={1}>Dashboard</Heading>
    <Heading level={2}>Recent runs</Heading>
    <Heading level={3}>Release Notes</Heading>
    <Heading level={4}>Provider endpoint</Heading>
  </Stack>
);

export const WithBody = () => (
  <Stack gap={2}>
    <Heading level={1}>Workflows</Heading>
    <Text>
      Reusable multi-step runs. A workflow chains agents and tools into one repeatable job.
    </Text>
    <Heading level={3}>Scheduled</Heading>
    <Text tone="muted" size="sm">
      Four workflows run on a cron schedule.
    </Text>
  </Stack>
);

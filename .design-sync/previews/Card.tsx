import { Badge, Button, Card, Icon, IconButton, Stack, Text } from '@martinstech/maestro-ds';

export const Basic = () => (
  <Card title="Release Notes" subtitle="Summarises merged commits into a changelog">
    <Text>
      Runs after every merge to main and posts the digest to the release channel.
    </Text>
  </Card>
);

export const WithActions = () => (
  <Card
    title="Nightly Build"
    subtitle="verify-windows"
    actions={
      <>
        <Badge tone="error" dot>
          failed
        </Badge>
        <IconButton icon={<Icon name="refresh" />} label="Re-run" size="sm" />
      </>
    }
  >
    <Text>Exited at the code-signing step after 4m 03s. The signing cert was not found.</Text>
  </Card>
);

export const Interactive = () => (
  <Stack direction="row" gap={3}>
    <Card interactive title="Backlog Triage" subtitle="12 runs this week" style={{ flex: 1 }}>
      <Text tone="muted" size="sm">
        Labels and assigns incoming issues.
      </Text>
    </Card>
    <Card selected interactive title="Doc Sweep" subtitle="Selected" style={{ flex: 1 }}>
      <Text tone="muted" size="sm">
        Checks every link in the docs tree.
      </Text>
    </Card>
  </Stack>
);

export const Compact = () => (
  <Stack gap={3}>
    <Card padding="compact" title="Provider">
      <Stack direction="row" gap={2} align="center">
        <Badge tone="success" dot>
          connected
        </Badge>
        <Text size="sm" mono>
          llm.martinstech.net/v1
        </Text>
      </Stack>
    </Card>
    <Card padding="compact">
      <Stack direction="row" gap={3} align="center" justify="space-between">
        <Text tone="primary">Install the pending update?</Text>
        <Button size="sm">Install</Button>
      </Stack>
    </Card>
  </Stack>
);

import { Badge, Button, Card, Stack, Text, ThemeProvider } from '@martinstech/maestro-ds';

const Panel = () => (
  <Card title="Release Notes" subtitle="summarise-commits">
    <Stack gap={3}>
      <Text>Posts a changelog to the release channel after every merge to main.</Text>
      <Stack direction="row" gap={2} align="center">
        <Badge tone="success" dot>
          done
        </Badge>
        <Button size="sm">Run now</Button>
      </Stack>
    </Stack>
  </Card>
);

export const Light = () => (
  <ThemeProvider theme="light" style={{ padding: 20 }}>
    <Panel />
  </ThemeProvider>
);

export const Dark = () => (
  <ThemeProvider theme="dark" style={{ padding: 20 }}>
    <Panel />
  </ThemeProvider>
);

export const SideBySide = () => (
  <Stack direction="row" gap={0} align="stretch">
    <ThemeProvider theme="light" style={{ flex: 1, padding: 16 }}>
      <Panel />
    </ThemeProvider>
    <ThemeProvider theme="dark" style={{ flex: 1, padding: 16 }}>
      <Panel />
    </ThemeProvider>
  </Stack>
);

import type { ReactNode } from 'react';
import { Badge, Button, Card, Stack, Text } from '@martinstech/maestro-ds';

const Box = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'var(--mds-bg-secondary)',
      border: '1px solid var(--mds-border-medium)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      color: 'var(--mds-text-secondary)',
    }}
  >
    {children}
  </div>
);

export const Column = () => (
  <Stack gap={3}>
    <Box>gap 3 — 12px</Box>
    <Box>the default vertical rhythm</Box>
    <Box>between related blocks</Box>
  </Stack>
);

export const Row = () => (
  <Stack direction="row" gap={2} align="center">
    <Box>one</Box>
    <Box>two</Box>
    <Box>three</Box>
  </Stack>
);

export const GapScale = () => (
  <Stack gap={4}>
    {([1, 2, 3, 4, 6] as const).map((g) => (
      <Stack key={g} direction="row" gap={g} align="center">
        <Text tone="muted" size="sm" style={{ width: 56 }}>
          gap {g}
        </Text>
        <Box>a</Box>
        <Box>b</Box>
        <Box>c</Box>
      </Stack>
    ))}
  </Stack>
);

export const Toolbar = () => (
  <Card padding="compact">
    <Stack direction="row" gap={3} align="center" justify="space-between">
      <Stack direction="row" gap={2} align="center">
        <Text tone="primary">Release Notes</Text>
        <Badge tone="success" dot>
          done
        </Badge>
      </Stack>
      <Stack direction="row" gap={2}>
        <Button size="sm" variant="secondary">
          Logs
        </Button>
        <Button size="sm">Run</Button>
      </Stack>
    </Stack>
  </Card>
);

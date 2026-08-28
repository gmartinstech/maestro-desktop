import { Badge, Stack } from '@martinstech/maestro-ds';

export const Tones = () => (
  <Stack direction="row" gap={2} align="center" wrap>
    <Badge>draft</Badge>
    <Badge tone="success">passed</Badge>
    <Badge tone="warning">degraded</Badge>
    <Badge tone="error">failed</Badge>
    <Badge tone="info">queued</Badge>
    <Badge tone="accent">beta</Badge>
  </Stack>
);

export const RunStates = () => (
  <Stack direction="row" gap={2} align="center" wrap>
    <Badge tone="info" dot>
      running
    </Badge>
    <Badge tone="success" dot>
      done
    </Badge>
    <Badge tone="error" dot>
      failed
    </Badge>
    <Badge dot>idle</Badge>
  </Stack>
);

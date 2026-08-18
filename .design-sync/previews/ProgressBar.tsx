import { Card, ProgressBar, Stack } from '@martinstech/maestro-ds';

export const Tones = () => (
  <Stack gap={5} style={{ maxWidth: 420 }}>
    <ProgressBar value={62} label="Workflow progress" showValue />
    <ProgressBar value={38} label="Downloading update" showValue tone="gold" />
    <ProgressBar value={84} label="Context window used" hint="84% of 200K" tone="error" />
  </Stack>
);

export const Bare = () => (
  <Stack gap={4} style={{ maxWidth: 420 }}>
    <ProgressBar value={0} />
    <ProgressBar value={25} />
    <ProgressBar value={50} />
    <ProgressBar value={75} />
    <ProgressBar value={100} />
  </Stack>
);

export const InCard = () => (
  <Card title="Installing update" subtitle="Maestro Studio 1.1756.0" style={{ maxWidth: 420 }}>
    <ProgressBar value={71} label="Downloading" showValue tone="gold" />
  </Card>
);

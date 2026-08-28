import { Button, Icon, Stack } from '@martinstech/maestro-ds';

export const Variants = () => (
  <Stack direction="row" gap={2} align="center" wrap>
    <Button>Run agent</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="ghost">Dismiss</Button>
    <Button variant="accent">Upgrade</Button>
    <Button variant="danger">Delete run</Button>
  </Stack>
);

export const Sizes = () => (
  <Stack direction="row" gap={2} align="center">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </Stack>
);

export const WithIcons = () => (
  <Stack direction="row" gap={2} align="center" wrap>
    <Button icon={<Icon name="plus" size={15} />}>New agent</Button>
    <Button variant="secondary" icon={<Icon name="refresh" size={15} />}>
      Refresh
    </Button>
    <Button variant="ghost" trailing={<Icon name="chevronRight" size={15} />}>
      All workflows
    </Button>
  </Stack>
);

export const States = () => (
  <Stack direction="row" gap={2} align="center" wrap>
    <Button loading>Starting…</Button>
    <Button disabled>Unavailable</Button>
    <Button variant="secondary" disabled>
      Cancel
    </Button>
  </Stack>
);

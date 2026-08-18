import { Icon, IconButton, Stack, Text } from '@martinstech/maestro-ds';

export const Sizes = () => (
  <Stack direction="row" gap={3} align="center">
    <IconButton icon={<Icon name="settings" size={14} />} label="Settings" size="sm" />
    <IconButton icon={<Icon name="settings" />} label="Settings" size="md" />
    <IconButton icon={<Icon name="settings" size={18} />} label="Settings" size="lg" />
  </Stack>
);

export const TitleBarCluster = () => (
  <Stack direction="row" gap={1} align="center">
    <IconButton icon={<Icon name="arrowLeft" />} label="Back" size="sm" />
    <IconButton icon={<Icon name="arrowRight" />} label="Forward" size="sm" />
    <IconButton icon={<Icon name="panelLeft" />} label="Toggle sidebar" size="sm" active />
    <IconButton icon={<Icon name="search" />} label="Search" size="sm" />
    <IconButton icon={<Icon name="bell" />} label="Notifications" size="sm" dot />
  </Stack>
);

export const States = () => (
  <Stack direction="row" gap={3} align="center">
    <IconButton icon={<Icon name="refresh" />} label="Refresh" />
    <IconButton icon={<Icon name="panelLeft" />} label="Panel" active />
    <IconButton icon={<Icon name="trash" />} label="Delete" disabled />
    <Text tone="muted" size="sm">
      default · active · disabled
    </Text>
  </Stack>
);

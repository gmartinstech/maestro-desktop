import { Icon, IconButton, MaestroLogo, Stack, Text, TitleBar } from '@martinstech/maestro-ds';

export const Windows = () => (
  <Stack gap={2}>
    <TitleBar
      platform="win"
      leading={<MaestroLogo size={22} />}
      title="Maestro Studio"
      nav={
        <>
          <IconButton icon={<Icon name="arrowLeft" />} label="Back" size="sm" />
          <IconButton icon={<Icon name="arrowRight" />} label="Forward" size="sm" />
        </>
      }
      actions={
        <>
          <IconButton icon={<Icon name="search" />} label="Search" size="sm" />
          <IconButton icon={<Icon name="bell" />} label="Notifications" size="sm" dot />
        </>
      }
    />
    <Text tone="muted" size="sm">
      138px is reserved on the right for the Windows minimise / maximise / close overlay.
    </Text>
  </Stack>
);

export const Mac = () => (
  <Stack gap={2}>
    <TitleBar
      platform="mac"
      leading={<MaestroLogo size={22} />}
      title="Maestro Studio"
      actions={<IconButton icon={<Icon name="settings" />} label="Settings" size="sm" />}
    />
    <Text tone="muted" size="sm">
      78px is reserved on the left for the macOS traffic lights.
    </Text>
  </Stack>
);

export const Minimal = () => (
  <TitleBar platform="win" leading={<MaestroLogo size={22} markOnly />} title="Maestro Studio" />
);

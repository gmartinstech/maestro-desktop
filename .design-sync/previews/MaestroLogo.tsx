import { MaestroLogo, Stack, Text, ThemeProvider } from '@martinstech/maestro-ds';

export const Sizes = () => (
  <Stack gap={4}>
    <MaestroLogo size={20} />
    <MaestroLogo size={24} />
    <MaestroLogo size={32} />
  </Stack>
);

export const MarkOnly = () => (
  <Stack direction="row" gap={4} align="center">
    <MaestroLogo markOnly size={22} />
    <MaestroLogo markOnly size={28} />
    <MaestroLogo markOnly size={40} />
    <Text tone="muted" size="sm">
      Used in the collapsed rail and anywhere under 24px.
    </Text>
  </Stack>
);

export const Products = () => (
  <Stack gap={3}>
    <MaestroLogo product="Maestro Studio" size={26} />
    <MaestroLogo product="MartinsConnect" size={26} />
    <MaestroLogo product="MartinsTech" size={26} />
  </Stack>
);

export const OnDark = () => (
  <ThemeProvider theme="dark" style={{ padding: 24 }}>
    <Stack gap={3}>
      <MaestroLogo size={26} />
      <Text tone="muted" size="sm">
        The tile inverts to gold with dark ink on a dark surface.
      </Text>
    </Stack>
  </ThemeProvider>
);

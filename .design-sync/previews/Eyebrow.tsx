import { Eyebrow, Heading, Stack, Text } from '@martinstech/maestro-ds';

export const AboveHeading = () => (
  <Stack gap={4}>
    <Stack gap={1}>
      <Eyebrow>Provider</Eyebrow>
      <Heading level={2}>Model routing</Heading>
      <Text>Every agent turn is sent through provedor-ia.</Text>
    </Stack>
    <Stack gap={1}>
      <Eyebrow>Appearance</Eyebrow>
      <Heading level={2}>Theme and motion</Heading>
      <Text>Applies to this machine only.</Text>
    </Stack>
  </Stack>
);

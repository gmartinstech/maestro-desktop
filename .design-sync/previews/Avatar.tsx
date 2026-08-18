import { Avatar, Stack, Text } from '@martinstech/maestro-ds';

export const Sizes = () => (
  <Stack direction="row" gap={3} align="center">
    <Avatar name="Gabriel Martins" size="sm" />
    <Avatar name="Gabriel Martins" size="md" />
    <Avatar name="Gabriel Martins" size="lg" />
  </Stack>
);

export const PeopleAndAgents = () => (
  <Stack gap={3}>
    <Stack direction="row" gap={2} align="center">
      <Avatar name="Gabriel Martins" />
      <Text tone="primary">Gabriel Martins</Text>
      <Text tone="muted" size="sm">
        person
      </Text>
    </Stack>
    <Stack direction="row" gap={2} align="center">
      <Avatar name="Release Notes" gold />
      <Text tone="primary">Release Notes</Text>
      <Text tone="muted" size="sm">
        agent — gold marks the agent side of a conversation
      </Text>
    </Stack>
  </Stack>
);

export const Initials = () => (
  <Stack direction="row" gap={2} align="center">
    <Avatar name="Gabriel Martins" />
    <Avatar name="Ana" />
    <Avatar name="Doc Sweep" gold />
    <Avatar name="Nightly Build Verifier" gold />
  </Stack>
);

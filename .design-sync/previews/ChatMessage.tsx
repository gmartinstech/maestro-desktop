import { Badge, Card, ChatMessage, Icon, Stack, Text } from '@martinstech/maestro-ds';

export const Conversation = () => (
  <Stack gap={5}>
    <ChatMessage author="user" name="Gabriel Martins" meta="10:42">
      Summarise what changed in the Windows build since Friday and flag anything that touches
      auto-update.
    </ChatMessage>
    <ChatMessage author="agent" name="Release Notes" meta="Claude Opus 5 · 10:42">
      Three commits land since Friday. Two are build-cache changes; the third repoints the update
      feed at the CDN and adds a signature check before install. That last one touches auto-update —
      worth a look before you ship.
    </ChatMessage>
    <ChatMessage author="user" name="Gabriel Martins" meta="10:44">
      Open the diff for the update feed change.
    </ChatMessage>
  </Stack>
);

export const WithToolCall = () => (
  <Stack gap={4}>
    <ChatMessage author="agent" name="Release Notes" meta="Claude Opus 5 · 10:44">
      Reading the file now.
    </ChatMessage>
    <Card padding="compact" style={{ maxWidth: 420 }}>
      <Stack direction="row" gap={2} align="center">
        <Icon name="tool" size={15} />
        <Text size="sm" tone="primary" as="span">
          read_file
        </Text>
        <Text mono size="sm" as="span" tone="muted">
          electron/main.js
        </Text>
        <div style={{ flex: 1 }} />
        <Badge tone="success">done</Badge>
      </Stack>
    </Card>
  </Stack>
);

export const Sides = () => (
  <Stack gap={4}>
    <ChatMessage author="user" name="Gabriel Martins">
      Right-aligned, tinted with the user-bubble token.
    </ChatMessage>
    <ChatMessage author="agent" name="Doc Sweep">
      Left-aligned on the surface colour, with the gold agent avatar.
    </ChatMessage>
  </Stack>
);

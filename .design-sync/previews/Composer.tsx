import { Button, Composer, Icon, IconButton, Stack } from '@martinstech/maestro-ds';

export const Empty = () => (
  <Stack style={{ maxWidth: 560 }}>
    <Composer action={<Button icon={<Icon name="send" size={15} />} size="sm">Send</Button>} />
  </Stack>
);

export const WithDraft = () => (
  <Stack style={{ maxWidth: 560 }}>
    <Composer
      value="Summarise what changed in the Windows build since Friday."
      tools={<IconButton icon={<Icon name="folder" />} label="Attach files" size="sm" />}
      action={
        <Button icon={<Icon name="send" size={15} />} size="sm">
          Send
        </Button>
      }
    />
  </Stack>
);

export const Running = () => (
  <Stack style={{ maxWidth: 560 }}>
    <Composer
      placeholder="Release Notes is running…"
      tools={<IconButton icon={<Icon name="folder" />} label="Attach files" size="sm" />}
      action={
        <Button variant="secondary" icon={<Icon name="stop" size={15} />} size="sm">
          Stop
        </Button>
      }
    />
  </Stack>
);

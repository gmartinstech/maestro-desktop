import { Select, Stack } from '@martinstech/maestro-ds';

const MODELS = [
  { value: 'opus', label: 'Claude Opus 5' },
  { value: 'sonnet', label: 'Claude Sonnet 5' },
  { value: 'haiku', label: 'Claude Haiku 4.5' },
];

export const Basic = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Select id="s1" label="Default model" options={MODELS} defaultValue="sonnet" />
    <Select
      id="s2"
      label="Theme"
      options={[
        { value: 'system', label: 'Match system' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
      defaultValue="system"
    />
  </Stack>
);

export const WithPlaceholder = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Select
      id="s3"
      label="Run as"
      placeholder="Choose an agent…"
      defaultValue=""
      options={[
        { value: 'notes', label: 'Release Notes' },
        { value: 'triage', label: 'Backlog Triage' },
        { value: 'sweep', label: 'Doc Sweep', disabled: true },
      ]}
      hint="Disabled agents are missing a provider key."
    />
  </Stack>
);

export const Disabled = () => (
  <Stack style={{ maxWidth: 380 }}>
    <Select id="s4" label="Provider" options={[{ value: 'pi', label: 'provedor-ia' }]} disabled />
  </Stack>
);

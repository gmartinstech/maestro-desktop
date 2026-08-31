import { Eyebrow, Heading, Stack, Text } from '@martinstech/maestro-ds';

export const Tones = () => (
  <Stack gap={2}>
    <Text tone="primary">
      Primary body copy. Inter at 13px is the reading size everywhere in the app.
    </Text>
    <Text>
      Secondary is the default tone — long-form explanation, help text, descriptions.
    </Text>
    <Text tone="muted">Muted carries metadata: timestamps, counts, provenance.</Text>
  </Stack>
);

export const Sizes = () => (
  <Stack gap={2}>
    <Text size="lg" tone="primary">
      Large — 15px, for the lead sentence of a panel.
    </Text>
    <Text>Medium — 13px, the default.</Text>
    <Text size="sm" tone="muted">
      Small — 12px, for captions under a control.
    </Text>
  </Stack>
);

export const Monospace = () => (
  <Stack gap={2}>
    <Text mono>run_a41f92c0 · claude-opus-5 · 48.2s</Text>
    <Text mono>C:\Users\gabriel\maestro\workflows\verify-windows.yaml</Text>
    <Text tone="muted" size="sm">
      IBM Plex Mono for anything the user might copy — ids, paths, model names.
    </Text>
  </Stack>
);

export const InContext = () => (
  <Stack gap={2}>
    <Eyebrow>Provider</Eyebrow>
    <Heading level={2}>Model routing</Heading>
    <Text>
      Every agent turn is sent through provedor-ia. Changing the endpoint here affects all
      agents on this machine, including scheduled runs.
    </Text>
    <Text tone="muted" size="sm">
      Last verified 2 minutes ago
    </Text>
  </Stack>
);

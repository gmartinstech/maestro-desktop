import { Icon, Stack, Text } from '@martinstech/maestro-ds';

const NAMES = [
  'dashboard',
  'grid',
  'agent',
  'workflow',
  'terminal',
  'tool',
  'sparkle',
  'chart',
  'settings',
  'search',
  'plus',
  'check',
  'x',
  'info',
  'warning',
  'error',
  'success',
  'bell',
  'user',
  'folder',
  'file',
  'copy',
  'trash',
  'external',
  'refresh',
  'send',
  'play',
  'pause',
  'stop',
  'moon',
  'sun',
  'arrowLeft',
  'arrowRight',
  'chevronRight',
  'chevronDown',
  'panelLeft',
] as const;

export const AllGlyphs = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 16 }}>
    {NAMES.map((n) => (
      <Stack key={n} gap={1} align="center">
        <Icon name={n} size={20} />
        <Text tone="muted" style={{ fontSize: 9, textAlign: 'center' }}>
          {n}
        </Text>
      </Stack>
    ))}
  </div>
);

export const Sizes = () => (
  <Stack direction="row" gap={4} align="center">
    <Icon name="agent" size={14} />
    <Icon name="agent" size={16} />
    <Icon name="agent" size={20} />
    <Icon name="agent" size={28} />
    <Icon name="agent" size={40} />
  </Stack>
);

export const StatusColours = () => (
  <Stack direction="row" gap={4} align="center">
    <Icon name="success" size={22} color="var(--mds-success)" />
    <Icon name="warning" size={22} color="var(--mds-warning)" />
    <Icon name="error" size={22} color="var(--mds-error)" />
    <Icon name="info" size={22} color="var(--mds-info)" />
    <Icon name="sparkle" size={22} color="var(--mds-brand-gold)" />
  </Stack>
);

export const Filled = () => (
  <Stack direction="row" gap={4} align="center">
    <Icon name="play" size={22} filled />
    <Icon name="pause" size={22} />
    <Icon name="stop" size={22} filled />
  </Stack>
);

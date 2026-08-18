import { CommandPalette, Icon } from '@martinstech/maestro-ds';

const ITEMS = [
  { id: 'run-notes', label: 'Run Release Notes', group: 'Agents', icon: <Icon name="agent" size={15} />, shortcut: 'Enter' },
  { id: 'run-triage', label: 'Run Backlog Triage', group: 'Agents', icon: <Icon name="agent" size={15} /> },
  { id: 'wf-verify', label: 'verify-windows', group: 'Workflows', icon: <Icon name="workflow" size={15} /> },
  { id: 'wf-links', label: 'link-check', group: 'Workflows', icon: <Icon name="workflow" size={15} /> },
  { id: 'settings', label: 'Open settings', group: 'Commands', icon: <Icon name="settings" size={15} />, shortcut: 'Ctrl ,' },
  { id: 'theme', label: 'Toggle dark mode', group: 'Commands', icon: <Icon name="moon" size={15} /> },
];

export const Open = () => (
  <div style={{ position: 'relative', height: 500, background: 'var(--mds-bg-page)' }}>
    <CommandPalette open query="" items={ITEMS} activeId="run-notes" />
  </div>
);

export const Filtered = () => (
  <div style={{ position: 'relative', height: 500, background: 'var(--mds-bg-page)' }}>
    <CommandPalette
      open
      query="verify"
      items={ITEMS.filter((i) => i.label.toLowerCase().includes('verify'))}
      activeId="wf-verify"
    />
  </div>
);

export const NoMatches = () => (
  <div style={{ position: 'relative', height: 300, background: 'var(--mds-bg-page)' }}>
    <CommandPalette open query="zzz" items={[]} emptyLabel="No agents, workflows or commands match “zzz”" />
  </div>
);

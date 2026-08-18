import type { ReactNode } from 'react';
import { Button, Icon, IconButton, Tooltip } from '@martinstech/maestro-ds';

// `open` is pinned so the tip shows in a static card — in the app, leave it unset and let
// hover drive it. Each cell reserves space on every side so the tip never clips or collides.
const Cell = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', placeItems: 'center', height: 120, padding: '0 90px' }}>
    {children}
  </div>
);

export const Top = () => (
  <Cell>
    <Tooltip content="Stop the current run" placement="top" open>
      <Button variant="secondary">Stop</Button>
    </Tooltip>
  </Cell>
);

export const Bottom = () => (
  <Cell>
    <Tooltip content="Re-run with the same input" placement="bottom" open>
      <Button variant="secondary">Re-run</Button>
    </Tooltip>
  </Cell>
);

export const Left = () => (
  <Cell>
    <Tooltip content="Open the run log" placement="left" open>
      <Button variant="secondary">Logs</Button>
    </Tooltip>
  </Cell>
);

export const Right = () => (
  <Cell>
    <Tooltip content="Copy the run id" placement="right" open>
      <Button variant="secondary">Copy</Button>
    </Tooltip>
  </Cell>
);

export const OnIconButton = () => (
  <Cell>
    <Tooltip content="Stop the current run" placement="top" open>
      <IconButton icon={<Icon name="stop" />} label="Stop" />
    </Tooltip>
  </Cell>
);

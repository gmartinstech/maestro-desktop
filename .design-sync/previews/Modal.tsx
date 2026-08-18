import type { ReactNode } from 'react';
import { Button, Input, Modal, Select, Stack, Text } from '@martinstech/maestro-ds';

// The scrim is absolutely positioned, so each cell provides its own positioned, sized box.
const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ position: 'relative', height: 340, background: 'var(--mds-bg-page)' }}>{children}</div>
);

export const Confirm = () => (
  <Frame>
    <Modal
      open
      size="sm"
      title="Delete this agent?"
      subtitle="Release Notes and its 184 recorded runs."
      onClose={() => {}}
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button variant="danger">Delete agent</Button>
        </>
      }
    >
      <Text>Run history is kept for 30 days after deletion, then removed permanently.</Text>
    </Modal>
  </Frame>
);

export const Form = () => (
  <Frame>
    <Modal
      open
      title="New agent"
      subtitle="Agents run workflows on your behalf."
      onClose={() => {}}
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Create agent</Button>
        </>
      }
    >
      <Stack gap={4}>
        <Input id="m1" label="Name" placeholder="Release Notes" required />
        <Select
          id="m2"
          label="Model"
          defaultValue="sonnet"
          options={[
            { value: 'opus', label: 'Claude Opus 5' },
            { value: 'sonnet', label: 'Claude Sonnet 5' },
          ]}
        />
      </Stack>
    </Modal>
  </Frame>
);

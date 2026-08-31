import { Checkbox, Stack } from '@martinstech/maestro-ds';

export const States = () => (
  <Stack gap={3}>
    <Checkbox checked label="Run on startup" />
    <Checkbox checked={false} label="Notify me when a run fails" />
    <Checkbox checked disabled label="Managed by policy" />
  </Stack>
);

export const WithDescriptions = () => (
  <Stack gap={4} style={{ maxWidth: 460 }}>
    <Checkbox
      checked
      label="Include tool output"
      description="Attach the full stdout of every tool call to the run record."
    />
    <Checkbox
      checked={false}
      label="Retry on failure"
      description="Re-run once automatically when the agent exits non-zero."
    />
  </Stack>
);

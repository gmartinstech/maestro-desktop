import { Alert, Button, Stack } from '@martinstech/maestro-ds';

export const Tones = () => (
  <Stack gap={3}>
    <Alert tone="info" title="Update available">
      Maestro Studio 1.1756.0 is ready to install.
    </Alert>
    <Alert tone="success" title="Connection verified">
      Reached the provider 2 minutes ago.
    </Alert>
    <Alert tone="warning" title="Provider unreachable">
      Retrying in 30 seconds.
    </Alert>
    <Alert tone="error" title="Run failed">
      The signing certificate was not found on this machine.
    </Alert>
  </Stack>
);

export const WithAction = () => (
  <Alert
    tone="warning"
    title="Backend is not responding"
    action={
      <Button size="sm" variant="secondary">
        Restart
      </Button>
    }
  >
    Agent turns will queue until it comes back.
  </Alert>
);

export const Untitled = () => (
  <Alert tone="info">Runs older than 30 days are archived automatically.</Alert>
);

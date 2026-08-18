import { Stack, Toast } from '@martinstech/maestro-ds';

export const Tones = () => (
  <Stack gap={3} align="flex-start">
    <Toast tone="success" message="Workflow finished in 48s" />
    <Toast tone="error" message="Nightly Build failed at the signing step" />
    <Toast tone="info" message="Update 1.1756.0 downloaded" />
  </Stack>
);

export const WithAction = () => (
  <Stack gap={3} align="flex-start">
    <Toast tone="success" message="Workflow finished in 48s" actionLabel="View run" />
    <Toast tone="error" message="Backend is not responding" actionLabel="Retry" />
    <Toast tone="info" message="Update 1.1756.0 downloaded" actionLabel="Restart" />
  </Stack>
);

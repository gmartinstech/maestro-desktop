import { Input, Stack } from '@martinstech/maestro-ds';

export const Basic = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Input id="p1" label="Agent name" defaultValue="Release Notes" />
    <Input id="p2" label="Description" placeholder="What should this agent do?" />
  </Stack>
);

export const WithHint = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Input
      id="p3"
      label="Endpoint"
      defaultValue="https://llm.martinstech.net/v1"
      mono
      hint="All model traffic goes through provedor-ia."
    />
    <Input id="p4" label="API key" type="password" defaultValue="sk-abc123" required />
  </Stack>
);

export const ErrorState = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Input id="p5" label="Agent name" defaultValue="Doc Sweep" error="An agent with this name already exists." required />
    <Input id="p6" label="Timeout (seconds)" defaultValue="0" error="Must be greater than zero." />
  </Stack>
);

export const Disabled = () => (
  <Stack gap={4} style={{ maxWidth: 380 }}>
    <Input id="p7" label="Workspace" defaultValue="maestro-desktop" disabled hint="Set at install time." />
    <Input id="p8" placeholder="Search agents…" />
  </Stack>
);

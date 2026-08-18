import { Button, Icon, IconButton, PageHeader, Stack } from '@martinstech/maestro-ds';

export const Basic = () => (
  <PageHeader title="Dashboard" subtitle="Everything your agents did today, in one place." />
);

export const WithActions = () => (
  <PageHeader
    title="Workflows"
    subtitle="Reusable multi-step runs."
    actions={
      <>
        <Button variant="secondary" icon={<Icon name="refresh" size={15} />}>
          Refresh
        </Button>
        <Button icon={<Icon name="plus" size={15} />}>New workflow</Button>
      </>
    }
  />
);

export const WithBreadcrumbs = () => (
  <PageHeader
    breadcrumbs={['Maestro Studio', 'Agents', 'Release Notes']}
    title="Release Notes"
    subtitle="Summarises merged commits into a changelog."
    actions={
      <Stack direction="row" gap={2} align="center">
        <IconButton icon={<Icon name="settings" />} label="Agent settings" />
        <Button>Run now</Button>
      </Stack>
    }
  />
);

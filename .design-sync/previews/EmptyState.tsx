import { Button, Card, EmptyState, Icon } from '@martinstech/maestro-ds';

export const NoAgents = () => (
  <Card padding="flush">
    <EmptyState
      icon={<Icon name="agent" size={22} />}
      title="No agents yet"
      description="Create an agent to start orchestrating work. You can point it at a workflow or let it run ad hoc."
      action={<Button icon={<Icon name="plus" size={15} />}>New agent</Button>}
    />
  </Card>
);

export const NoResults = () => (
  <Card padding="flush">
    <EmptyState
      icon={<Icon name="search" size={22} />}
      title="No matches for “verify-win”"
      description="Check the spelling, or search across archived runs instead."
      action={
        <Button variant="secondary" size="sm">
          Search archived runs
        </Button>
      }
    />
  </Card>
);

export const Minimal = () => (
  <Card padding="flush">
    <EmptyState title="Nothing scheduled" description="Workflows you schedule will appear here." />
  </Card>
);

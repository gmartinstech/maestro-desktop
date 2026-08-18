import { Card, Grid, StatCard, Text } from '@martinstech/maestro-ds';

export const StatRow = () => (
  <Grid columns={4}>
    <StatCard label="Active agents" value="7" delta="+2 today" trend="up" />
    <StatCard label="Runs (24h)" value="184" delta="+12.4%" trend="up" />
    <StatCard label="Avg duration" value="48s" delta="-6.1%" trend="up" />
    <StatCard label="Failures" value="3" delta="+1" trend="down" />
  </Grid>
);

export const CardGallery = () => (
  <Grid columns={3}>
    <Card interactive title="Release Notes">
      <Text tone="muted" size="sm">
        Changelog from merged commits.
      </Text>
    </Card>
    <Card interactive title="Backlog Triage">
      <Text tone="muted" size="sm">
        Labels and assigns new issues.
      </Text>
    </Card>
    <Card interactive title="Doc Sweep">
      <Text tone="muted" size="sm">
        Checks every link in the docs tree.
      </Text>
    </Card>
  </Grid>
);

export const TwoUp = () => (
  <Grid columns={2}>
    <Card title="Provider">
      <Text tone="muted" size="sm">
        llm.martinstech.net/v1
      </Text>
    </Card>
    <Card title="Update channel">
      <Text tone="muted" size="sm">
        stable
      </Text>
    </Card>
  </Grid>
);

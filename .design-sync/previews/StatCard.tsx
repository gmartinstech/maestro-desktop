import { Grid, Icon, StatCard } from '@martinstech/maestro-ds';

export const Row = () => (
  <Grid columns={4}>
    <StatCard label="Active agents" value="7" delta="+2 today" trend="up" />
    <StatCard label="Runs (24h)" value="184" delta="+12.4%" trend="up" />
    <StatCard label="Avg duration" value="48s" delta="-6.1%" trend="up" />
    <StatCard label="Failures" value="3" delta="+1" trend="down" />
  </Grid>
);

export const Trends = () => (
  <Grid columns={3}>
    <StatCard label="Succeeded" value="181" delta="+9.2%" trend="up" caption="vs previous 24h" />
    <StatCard label="Failed" value="3" delta="+1" trend="down" caption="vs previous 24h" />
    <StatCard label="Queued" value="0" delta="no change" trend="flat" caption="vs previous 24h" />
  </Grid>
);

export const WithIcons = () => (
  <Grid columns={2}>
    <StatCard
      label="Tokens used"
      value="1.24M"
      delta="+18.0%"
      trend="up"
      icon={<Icon name="sparkle" size={15} />}
    />
    <StatCard
      label="Tool calls"
      value="3,910"
      delta="-4.4%"
      trend="flat"
      icon={<Icon name="tool" size={15} />}
    />
  </Grid>
);

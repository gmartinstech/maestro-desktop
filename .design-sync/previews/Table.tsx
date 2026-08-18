import { Avatar, Badge, Card, Icon, IconButton, Stack, Table } from '@martinstech/maestro-ds';

interface Run {
  agent: string;
  workflow: string;
  status: 'running' | 'done' | 'failed';
  duration: string;
  tokens: string;
}

const ROWS: Run[] = [
  { agent: 'Release Notes', workflow: 'summarise-commits', status: 'running', duration: '00:41', tokens: '18.2K' },
  { agent: 'Backlog Triage', workflow: 'label-issues', status: 'done', duration: '01:12', tokens: '42.9K' },
  { agent: 'Doc Sweep', workflow: 'link-check', status: 'done', duration: '00:26', tokens: '7.4K' },
  { agent: 'Nightly Build', workflow: 'verify-windows', status: 'failed', duration: '04:03', tokens: '96.1K' },
];

const TONE = { running: 'info', done: 'success', failed: 'error' } as const;

export const RunHistory = () => (
  <Card title="Recent runs" subtitle="Last 24 hours" padding="flush">
    <Table
      rows={ROWS}
      rowKey={(r) => r.agent}
      columns={[
        { key: 'agent', header: 'Agent', render: (r) => <span className="mds-table__name">{r.agent}</span> },
        { key: 'wf', header: 'Workflow', render: (r) => <span className="mds-mono">{r.workflow}</span> },
        {
          key: 'status',
          header: 'Status',
          render: (r) => (
            <Badge tone={TONE[r.status]} dot>
              {r.status}
            </Badge>
          ),
        },
        { key: 'tokens', header: 'Tokens', numeric: true, render: (r) => r.tokens },
        { key: 'dur', header: 'Duration', numeric: true, render: (r) => r.duration },
      ]}
    />
  </Card>
);

export const WithAvatarsAndActions = () => (
  <Card padding="flush">
    <Table
      rows={ROWS.slice(0, 3)}
      rowKey={(r) => r.agent}
      columns={[
        {
          key: 'agent',
          header: 'Agent',
          render: (r) => (
            <Stack direction="row" gap={2} align="center">
              <Avatar name={r.agent} size="sm" gold />
              <span className="mds-table__name">{r.agent}</span>
            </Stack>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge>,
        },
        { key: 'dur', header: 'Duration', numeric: true, render: (r) => r.duration },
        {
          key: 'act',
          header: '',
          width: '80px',
          render: () => (
            <Stack direction="row" gap={1} justify="flex-end">
              <IconButton icon={<Icon name="refresh" size={14} />} label="Re-run" size="sm" />
              <IconButton icon={<Icon name="trash" size={14} />} label="Delete" size="sm" />
            </Stack>
          ),
        },
      ]}
    />
  </Card>
);

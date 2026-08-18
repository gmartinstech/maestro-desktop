import { AgentCard } from '@martinstech/maestro-ds';

const Frame = ({ children, h = 260 }: { children: React.ReactNode; h?: number }) => (
  <div style={{ position: 'relative', height: h, background: 'var(--mds-bg-page)', borderRadius: 14 }}>{children}</div>
);

export const Collapsed = () => (
  <Frame>
    <AgentCard
      x={24}
      y={24}
      title="Release Notes"
      status="running"
      model="Claude Opus 5"
      elapsed="00:41"
      cost="$0.02"
      hasMemory
      preview="Reading electron/main.js to check the update feed change…"
    />
  </Frame>
);

export const Selected = () => (
  <Frame>
    <AgentCard x={24} y={24} title="Doc Sweep" status="done" model="Claude Sonnet 5" elapsed="00:26" cost="$0.00" preview="Checked 84 links across the docs tree. 2 broken." selected />
  </Frame>
);

export const AwaitingApproval = () => (
  <Frame h={300}>
    <AgentCard
      x={24}
      y={24}
      title="Backlog Triage"
      status="waiting on approval"
      approval={{ tool: 'label_issues', summary: 'Apply 12 labels across the open backlog.' }}
    />
  </Frame>
);

export const Highlighted = () => (
  <Frame>
    <AgentCard x={24} y={24} title="Nightly Build" status="queued" highlighted />
  </Frame>
);

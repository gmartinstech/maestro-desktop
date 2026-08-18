import { AgentChatScreen } from '@martinstech/maestro-ds';

export const Running = () => (
  <div style={{ height: 620 }}>
    <AgentChatScreen agentName="Release Notes" status="running" />
  </div>
);

export const WithDraft = () => (
  <div style={{ height: 620 }}>
    <AgentChatScreen
      agentName="Backlog Triage"
      status="idle"
      draft="Label everything opened since Friday and assign the build failures to me."
    />
  </div>
);

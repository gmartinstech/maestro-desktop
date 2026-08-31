import { AppShell } from './AppShell';
import { TitleBar } from './TitleBar';
import { Sidebar, SidebarItem, SidebarSection } from './Sidebar';
import { MaestroLogo } from './MaestroLogo';
import { ChatMessage, Composer } from './ChatMessage';
import { Stack } from './Stack';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { Card } from './Card';

export interface ChatTurn {
  author: 'user' | 'agent';
  name: string;
  text: string;
  meta?: string;
}

export interface AgentChatScreenProps {
  /** Name shown in the conversation header. */
  agentName?: string;
  /** Run state badge beside the name. */
  status?: 'idle' | 'running' | 'failed';
  /** The conversation. */
  turns?: ChatTurn[];
  /** Draft text sitting in the composer. */
  draft?: string;
  platform?: 'win' | 'mac';
}

const DEFAULT_TURNS: ChatTurn[] = [
  {
    author: 'user',
    name: 'Gabriel Martins',
    text: 'Summarise what changed in the Windows build since Friday and flag anything that touches auto-update.',
    meta: '10:42',
  },
  {
    author: 'agent',
    name: 'Release Notes',
    text: 'Three commits land in the Windows build since Friday. Two are build-cache changes; the third repoints the update feed at the CDN and adds a signature check before install. That last one touches auto-update — worth a look before you ship.',
    meta: 'Claude Opus 5 · 10:42',
  },
  {
    author: 'user',
    name: 'Gabriel Martins',
    text: 'Open the diff for the update feed change.',
    meta: '10:44',
  },
];

// Filtered against agentName so the active session never appears twice in the rail.
const OTHER_SESSIONS = ['Release Notes', 'Backlog Triage', 'Doc Sweep', 'Nightly Build'];

const STATUS = {
  idle: { tone: 'neutral', label: 'Idle' },
  running: { tone: 'info', label: 'Running' },
  failed: { tone: 'error', label: 'Failed' },
} as const;

/**
 * Reference layout for the agent conversation route: a session rail, a scrolling
 * transcript and the composer pinned at the bottom of the content pane.
 */
export function AgentChatScreen({
  agentName = 'Release Notes',
  status = 'running',
  turns = DEFAULT_TURNS,
  draft = '',
  platform = 'win',
}: AgentChatScreenProps) {
  const s = STATUS[status];
  // The default transcript is written for one agent; rename its agent turns so a different
  // agentName does not leave the bubbles attributed to someone else.
  const shown = turns.map((t) => (t.author === 'agent' ? { ...t, name: agentName } : t));
  return (
    <AppShell
      flush
      titleBar={
        <TitleBar platform={platform} leading={<MaestroLogo size={22} />} title="Maestro Studio" />
      }
      sidebar={
        <Sidebar>
          <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} />
          <SidebarSection label="Sessions">
            <SidebarItem label={agentName} icon={<Icon name="agent" />} active />
            {OTHER_SESSIONS.filter((s) => s !== agentName).map((s) => (
              <SidebarItem key={s} label={s} icon={<Icon name="agent" />} />
            ))}
          </SidebarSection>
        </Sidebar>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--mds-space-3)',
            padding: '12px 24px',
            borderBottom: '1px solid var(--mds-border-subtle)',
            background: 'var(--mds-bg-surface)',
          }}
        >
          <Icon name="agent" size={18} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{agentName}</span>
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
          <div style={{ flex: 1 }} />
          <IconButton icon={<Icon name="stop" />} label="Stop run" size="sm" />
          <IconButton icon={<Icon name="settings" />} label="Session settings" size="sm" />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, minHeight: 0 }}>
          <Stack gap={5}>
            {shown.map((t, i) => (
              <ChatMessage key={i} author={t.author} name={t.name} meta={t.meta}>
                {t.text}
              </ChatMessage>
            ))}
            <Card padding="compact" style={{ maxWidth: 420 }}>
              <Stack direction="row" gap={2} align="center">
                <Icon name="tool" size={15} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>read_file</span>
                <span className="mds-mono" style={{ fontSize: 11, color: 'var(--mds-text-muted)' }}>
                  electron/main.js
                </span>
                <div style={{ flex: 1 }} />
                <Badge tone="success">done</Badge>
              </Stack>
            </Card>
          </Stack>
        </div>
        <div style={{ padding: '12px 24px 20px' }}>
          <Composer
            value={draft}
            tools={<IconButton icon={<Icon name="folder" />} label="Attach files" size="sm" />}
            action={
              <Button icon={<Icon name="send" size={15} />} size="sm">
                Send
              </Button>
            }
          />
        </div>
      </div>
    </AppShell>
  );
}

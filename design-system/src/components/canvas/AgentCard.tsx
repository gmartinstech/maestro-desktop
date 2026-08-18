import type { ReactNode } from 'react';
import { CanvasCardFrame } from './CanvasCardFrame';
import { Icon } from '../Icon';

export interface AgentApproval {
  tool: string;
  summary: string;
}

export interface AgentCardProps {
  x: number;
  y: number;
  /** 480x280 is the app's spawn default; expanded height is min(620, content). */
  width?: number;
  title: string;
  /** e.g. "queued", "running", "waiting on approval". */
  status: string;
  model?: string;
  elapsed?: string;
  cost?: string;
  hasMemory?: boolean;
  /** Collapsed shows one preview line with a pulsing dot; expanded shows the transcript. */
  expanded?: boolean;
  /** Collapsed-only: the last streamed line. */
  preview?: string;
  approval?: AgentApproval;
  selected?: boolean;
  highlighted?: boolean;
  children?: ReactNode;
}

/**
 * The primary canvas card, ported from AgentCard.tsx. Note what it deliberately lacks vs a
 * generic "chat card": no avatar, no kebab menu, no status dot in the header — just a title,
 * a status word, an optional memory chip, and a single close button.
 */
export function AgentCard({
  x,
  y,
  width = 480,
  title,
  status,
  model,
  elapsed,
  cost,
  hasMemory = false,
  expanded = false,
  preview,
  approval,
  selected = false,
  highlighted = false,
  children,
}: AgentCardProps) {
  return (
    <CanvasCardFrame x={x} y={y} width={width} height={expanded ? 620 : 'auto'} radius={12} selected={selected} highlighted={highlighted}>
      <div className="mds-agentcard__header">
        <Icon name="grid" size={14} className="mds-agentcard__drag-dots" />
        <span className="mds-agentcard__title">{title}</span>
        <span className="mds-agentcard__status">{status}</span>
        {hasMemory && (
          <span className="mds-agentcard__memory-chip">
            <Icon name="sparkle" size={12} />
            Memory
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Icon name="x" size={16} style={{ color: 'var(--mds-text-ghost)' }} />
      </div>
      {(model || elapsed || cost) && (
        <div className="mds-agentcard__meta">
          {model && <span>{model}</span>}
          {elapsed && <span>{elapsed}</span>}
          {cost && <span className="mds-agentcard__meta-cost">{cost}</span>}
        </div>
      )}
      {approval && (
        <div className="mds-agentcard__approval">
          <div className="mds-agentcard__approval-tool">{approval.tool}</div>
          <div className="mds-agentcard__approval-summary">{approval.summary}</div>
        </div>
      )}
      {expanded ? (
        <div className="mds-agentcard__body">{children}</div>
      ) : (
        preview && (
          <div className="mds-agentcard__preview">
            <span className="mds-agentcard__pulse-dot" />
            {preview}
          </div>
        )
      )}
    </CanvasCardFrame>
  );
}

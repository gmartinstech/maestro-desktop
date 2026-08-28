import { CanvasCardFrame } from './CanvasCardFrame';
import { Icon } from '../Icon';

export type NoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'gray';

/** Fixed paper palette — identical in light and dark, exactly as in the app. Not theme tokens. */
const PALETTE: Record<NoteColor, { bg: string; border: string; text: string }> = {
  yellow: { bg: '#FBE89C', border: '#E0C95A', text: '#3a2e0a' },
  pink: { bg: '#F8C3D0', border: '#DB94A6', text: '#3a131e' },
  blue: { bg: '#B6D7F0', border: '#86B5D8', text: '#0e2a3d' },
  green: { bg: '#C7E5B5', border: '#94C376', text: '#1c3210' },
  purple: { bg: '#D8C5EE', border: '#A98BCB', text: '#23123e' },
  gray: { bg: '#DEDDD6', border: '#A8A6A0', text: '#262522' },
};

export interface NoteCardProps {
  x: number;
  y: number;
  /** 240x200 is the app's spawn default. */
  width?: number;
  height?: number;
  color?: NoteColor;
  text: string;
  selected?: boolean;
}

/**
 * A sticky note, ported from NoteCard.tsx — the one card that is paper, not surface: its own
 * palette (not the token layer), a chromeless 18px header, and hover-revealed controls only.
 */
export function NoteCard({ x, y, width = 240, height = 200, color = 'yellow', text, selected = false }: NoteCardProps) {
  const p = PALETTE[color];
  return (
    <CanvasCardFrame
      x={x}
      y={y}
      width={width}
      height={height}
      radius={8}
      selected={selected}
      className="mds-notecard"
      style={{ background: p.bg, border: `1px solid ${p.border}` }}
    >
      <div className="mds-notecard__header" style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, padding: '2px 4px' }}>
        <Icon name="palette" size={13} style={{ color: p.text, opacity: 0.55 }} />
        <Icon name="x" size={13} style={{ color: p.text, opacity: 0.55 }} />
      </div>
      <div className="mds-notecard__body" style={{ color: p.text }}>
        {text}
      </div>
    </CanvasCardFrame>
  );
}

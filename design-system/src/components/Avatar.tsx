import { cx } from '../cx';

export interface AvatarProps {
  /** Full name — initials are derived from it when no image is given. */
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Gold tile with dark ink, used to mark the agent side of a conversation. */
  gold?: boolean;
  className?: string;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Round identity chip for people and agents. Falls back to initials when there is no image. */
export function Avatar({ name, src, size = 'md', gold = false, className }: AvatarProps) {
  return (
    <span
      className={cx('mds-avatar', size !== 'md' && `mds-avatar--${size}`, gold && 'mds-avatar--gold', className)}
      title={name}
    >
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

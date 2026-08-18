import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Avatar } from './Avatar';

export interface ChatMessageProps {
  /** `user` right-aligns the bubble and tints it with the user-bubble token. */
  author: 'user' | 'agent';
  /** Display name, also the source of the avatar initials. */
  name: string;
  /** Message body. Pass JSX for rich content — code blocks, tool cards, lists. */
  children?: ReactNode;
  /** Timestamp or model id, shown small above the bubble. */
  meta?: string;
  className?: string;
}

/** One turn in an agent conversation. */
export function ChatMessage({ author, name, children, meta, className }: ChatMessageProps) {
  return (
    <div className={cx('mds-msg', author === 'user' && 'mds-msg--user', className)}>
      <Avatar name={name} size="sm" gold={author === 'agent'} />
      <div style={{ minWidth: 0 }}>
        {meta && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--mds-text-muted)',
              marginBottom: 4,
              textAlign: author === 'user' ? 'right' : 'left',
            }}
          >
            {meta}
          </div>
        )}
        <div className="mds-msg__bubble">{children}</div>
      </div>
    </div>
  );
}

export interface ComposerProps {
  /** Current draft text. */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Left of the send button — attach, model picker, mode switch. */
  tools?: ReactNode;
  /** The send control. */
  action?: ReactNode;
  className?: string;
}

/** The prompt input: a bordered surface holding the textarea, tool slots and send action. */
export function Composer({
  value = '',
  onChange,
  placeholder = 'Ask Maestro to run something…',
  tools,
  action,
  className,
}: ComposerProps) {
  return (
    <div className={cx('mds-composer', className)}>
      <textarea
        className="mds-composer__input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        rows={1}
      />
      {tools}
      {action}
    </div>
  );
}

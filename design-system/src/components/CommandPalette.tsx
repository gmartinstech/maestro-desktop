import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';

export interface CommandItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Group heading this item sits under. Items are rendered in the order given. */
  group?: string;
  /** Right-aligned shortcut, e.g. "Ctrl K". */
  shortcut?: string;
}

export interface CommandPaletteProps {
  /** Renders nothing when false. */
  open: boolean;
  /** Current query text. */
  query?: string;
  onQueryChange?: (value: string) => void;
  placeholder?: string;
  items: CommandItem[];
  /** Id of the highlighted row — the one Enter would run. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Shown when `items` is empty. */
  emptyLabel?: string;
  className?: string;
}

/** Global search and command launcher, scrimmed over the shell. */
export function CommandPalette({
  open,
  query = '',
  onQueryChange,
  placeholder = 'Search agents, workflows and commands…',
  items,
  activeId,
  onSelect,
  emptyLabel = 'No matches',
  className,
}: CommandPaletteProps) {
  if (!open) return null;
  const groups: string[] = [];
  for (const item of items) {
    const g = item.group ?? '';
    if (!groups.includes(g)) groups.push(g);
  }
  return (
    <div className="mds-modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div className={cx('mds-palette', className)} role="dialog" aria-label="Command palette">
        <div className="mds-palette__search">
          <Icon name="search" size={17} />
          <input
            className="mds-palette__input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => onQueryChange?.(e.target.value)}
          />
          <span className="mds-kbd">Esc</span>
        </div>
        <div className="mds-palette__list">
          {items.length === 0 && (
            <div style={{ padding: '20px 12px', color: 'var(--mds-text-muted)', fontSize: 13 }}>
              {emptyLabel}
            </div>
          )}
          {groups.map((g) => (
            <div key={g}>
              {g && <div className="mds-palette__group">{g}</div>}
              {items
                .filter((i) => (i.group ?? '') === g)
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onSelect?.(i.id)}
                    className={cx('mds-palette__item', i.id === activeId && 'mds-palette__item--active')}
                  >
                    {i.icon}
                    {i.label}
                    {i.shortcut && <span className="mds-palette__hint">{i.shortcut}</span>}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

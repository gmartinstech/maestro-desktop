import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface TabItem {
  id: string;
  label: string;
  /** Trailing count pill — unread runs, matching tools. */
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Id of the selected tab. */
  value: string;
  onChange?: (id: string) => void;
  className?: string;
}

/** Underlined tab bar. The active tab carries the accent rule and colour. */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cx('mds-tabs', className)} role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          disabled={t.disabled}
          onClick={() => onChange?.(t.id)}
          className={cx('mds-tab', t.id === value && 'mds-tab--active')}
        >
          {t.icon}
          {t.label}
          {typeof t.count === 'number' && <span className="mds-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

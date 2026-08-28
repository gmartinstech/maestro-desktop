import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';

export interface SidebarProps {
  /** Rail mode: 56px wide, icons only. The app boots collapsed. */
  collapsed?: boolean;
  /** Width in px when expanded. The app defaults to 260 and clamps to 160-400. */
  width?: number;
  /** Pinned to the bottom of the rail — Settings, account, version. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Navigation rail. Compose it from SidebarSection and SidebarItem. */
export function Sidebar({ collapsed = false, width = 260, footer, children, className }: SidebarProps) {
  return (
    <nav
      className={cx('mds-sidebar', collapsed && 'mds-sidebar--collapsed', className)}
      style={collapsed ? undefined : { width }}
    >
      {children}
      {footer && (
        <>
          <div className="mds-sidebar__spacer" />
          {footer}
        </>
      )}
    </nav>
  );
}

export interface SidebarSectionProps {
  /** Uppercase group heading — "Dashboards", "Apps". */
  label: string;
  /** Renders the disclosure chevron and its rotation. */
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
  className?: string;
}

/** Collapsible group heading inside the rail. */
export function SidebarSection({
  label,
  expanded = true,
  onToggle,
  children,
  className,
}: SidebarSectionProps) {
  return (
    <div className={className}>
      <button type="button" className="mds-sidebar__section" onClick={onToggle}>
        <Icon
          name="chevronDown"
          size={11}
          style={{ transform: expanded ? undefined : 'rotate(-90deg)', transition: 'transform 150ms' }}
        />
        {label}
      </button>
      {expanded && children}
    </div>
  );
}

export interface SidebarItemProps {
  /** Row label. Hidden when the rail is collapsed. */
  label: string;
  /** 16px glyph — always present, since it is all that shows in the collapsed rail. */
  icon?: ReactNode;
  active?: boolean;
  /** Trailing count pill. */
  count?: number;
  collapsed?: boolean;
  onClick?: () => void;
  className?: string;
}

/** One navigation row. The active row gets the accent bar, tint and weight. */
export function SidebarItem({
  label,
  icon,
  active = false,
  count,
  collapsed = false,
  onClick,
  className,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cx('mds-navitem', active && 'mds-navitem--active', className)}
      style={collapsed ? { justifyContent: 'center', padding: 8 } : undefined}
    >
      {icon && <span className="mds-navitem__icon">{icon}</span>}
      {!collapsed && <span className="mds-navitem__label">{label}</span>}
      {!collapsed && typeof count === 'number' && (
        <span className="mds-navitem__count">{count}</span>
      )}
    </button>
  );
}

import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface PageHeaderProps {
  title: string;
  /** One line saying what the page is for. */
  subtitle?: string;
  /** Trail above the title. The last entry is rendered as the current page. */
  breadcrumbs?: string[];
  /** Right-aligned controls. At most one primary Button. */
  actions?: ReactNode;
  className?: string;
}

/** Page title block with the rule under it. Every content route opens with one. */
export function PageHeader({ title, subtitle, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <div className={cx('mds-pagehead', className)}>
      <div style={{ minWidth: 0 }}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="mds-pagehead__crumbs">
            {breadcrumbs.map((c, i) => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span>/</span>}
                {i === breadcrumbs.length - 1 ? <b>{c}</b> : c}
              </span>
            ))}
          </div>
        )}
        <h1 className="mds-heading mds-heading--1">{title}</h1>
        {subtitle && <div className="mds-pagehead__sub">{subtitle}</div>}
      </div>
      {actions && <div className="mds-pagehead__actions">{actions}</div>}
    </div>
  );
}

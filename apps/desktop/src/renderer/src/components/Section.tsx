import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Section({
  title,
  count,
  actions,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  count?: number | string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <header className="section-header" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="section-title">{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

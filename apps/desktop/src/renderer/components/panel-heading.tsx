import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function PanelHeading({ icon: Icon, title, id, description, action, badge }: {
  icon: LucideIcon;
  title: ReactNode;
  id?: string;
  description?: string;
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <span className="panel-icon"><Icon size={20} aria-hidden="true" /></span>
      <div>
        <div className="panel-heading-title-row">
          <h3 id={id}>{title}</h3>
          {badge}
        </div>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="panel-heading-action">{action}</div>}
    </div>
  );
}

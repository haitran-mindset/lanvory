import type { ComponentType, ReactNode } from 'react';
import './workspace-tabs.css';

type Tab<Id extends string> = {
  id: Id;
  label: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  count?: number;
};

export function WorkspaceTabs<const Id extends string>({ name, label, tabs, active, onChange }: {
  name: string;
  label: string;
  tabs: readonly Tab<NoInfer<Id>>[];
  active: Id;
  onChange(id: NoInfer<Id>): void;
}) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label={label}>
      {tabs.map(({ id, label: title, icon: Icon, count }, index) => (
        <button
          key={id}
          id={`${name}-tab-${id}`}
          type="button"
          role="tab"
          aria-controls={`${name}-panel-${id}`}
          aria-selected={active === id}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            const last = tabs.length - 1;
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft' ? (index + last) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? last : undefined;
            if (next === undefined) return;
            event.preventDefault();
            const nextId = tabs[next].id;
            onChange(nextId);
            document.getElementById(`${name}-tab-${nextId}`)?.focus();
          }}
        >
          <Icon size={16} aria-hidden={true} />
          {title}
          {count !== undefined && <span className="workspace-tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

export function WorkspaceTabPanel({ name, id, active, children }: {
  name: string;
  id: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace-tab-panel" id={`${name}-panel-${id}`} role="tabpanel"
      aria-labelledby={`${name}-tab-${id}`} hidden={active !== id} tabIndex={0}>
      {children}
    </div>
  );
}

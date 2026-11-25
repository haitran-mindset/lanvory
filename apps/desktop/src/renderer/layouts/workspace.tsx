import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { Activity, Boxes, Layers, Monitor, Network, RefreshCw, Settings } from 'lucide-react';

const navigation = [
  ['Devices', Monitor], ['Sharing', Layers], ['Services', Boxes], ['Network', Network], ['Settings', Settings],
] as const;

export type Page = typeof navigation[number][0];

export function Workspace({ page, onNavigate, status, online, lanActive, pendingFiles, action, children }: {
  page: Page;
  onNavigate(page: Page): void;
  status: string;
  online: boolean;
  lanActive: boolean;
  pendingFiles: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const scrollRegion = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { scrollRegion.current?.scrollTo(0, 0); }, [page]);

  return (
    <div className="shell" data-page={page}>
      <aside>
        <div className="brand"><span className="mark" aria-hidden="true" /><strong>Lanvory</strong><small>Local Network Platform</small></div>
        <nav aria-label="Workspace">
          {navigation.map(([label, Icon]) => (
            <div key={label}>
              {label === 'Services' && <button type="button" disabled title="Planned">
                <RefreshCw size={21} aria-hidden="true" />Sync
              </button>}
              <button aria-current={label === page ? 'page' : undefined} type="button" onClick={() => onNavigate(label)}
                aria-label={label === 'Sharing' && pendingFiles > 0
                  ? `Sharing, ${pendingFiles} incoming ${pendingFiles === 1 ? 'file' : 'files'} waiting`
                  : undefined}>
                <Icon size={21} aria-hidden="true" />{label}
                {label === 'Sharing' && pendingFiles > 0 && (
                  <span className="nav-pending-files" aria-hidden="true">{pendingFiles}</span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="status" role="status"><Activity size={20} aria-hidden="true" />
          <span><strong>{lanActive ? 'Local network on' : 'Local network off'}</strong><small>{status}</small></span>
          <i className={online && lanActive ? 'live' : ''} />
        </div>
      </aside>
      <main className="main-shell">
        <div className="workspace-header">
          <header><strong>lanvory</strong><span>/</span><span>local network, truly yours.</span></header>
          <div className="page-heading"><h2>{page === 'Devices' ? 'Nearby Devices' : page}</h2>{action}</div>
        </div>
        <div ref={scrollRegion} className="page-scroll" tabIndex={0} role="region" aria-label={`${page} content`}>{children}</div>
      </main>
    </div>
  );
}

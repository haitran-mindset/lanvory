import { ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { pairedDeviceName, readPairedNames } from '../../services/paired-names';

const eventsSchema = z.array(z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.string(),
  capability: z.string(),
  resource: z.string(),
  occurredAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
}));

export function PermissionActivity({ ownerId }: { ownerId?: string }) {
  const [events, setEvents] = useState<z.infer<typeof eventsSchema> | null>();
  const [loading, setLoading] = useState(false);
  const names = ownerId ? readPairedNames(ownerId) : {};

  async function refresh() {
    setLoading(true);
    const parsed = eventsSchema.safeParse(await window.lanvory.permissionActivity().catch(() => null));
    setEvents(parsed.success ? parsed.data : null);
    setLoading(false);
  }

  return (
    <details className="operation-card settings-activity" onToggle={(event) => {
      if (event.currentTarget.open && !loading && events === undefined) void refresh();
    }}>
      <summary>
        <span className="panel-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div className="settings-activity-title-wrap">
          <span className="settings-activity-title">Permission activity</span>
          <span className="settings-activity-desc">Audit log of resource and capability authorizations for paired devices.</span>
        </div>
        {events !== undefined && events !== null && (
          <span className="state-pill settings-activity-pill">
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
        )}
        <ChevronDown className="settings-activity-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="settings-activity-body">
        <div className="settings-activity-actions">
          <p className="settings-activity-hint">See when local resources and capabilities were authorized for paired devices.</p>
          <button type="button" className="refresh settings-activity-refresh-btn" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={13} className={loading ? 'spinning' : ''} aria-hidden="true" />
            <span>Refresh activity</span>
          </button>
        </div>
        {loading && <p role="status" className="settings-status">Reading permission activity…</p>}
        {events === null && <p role="status" className="settings-status is-error">Unable to read permission activity.</p>}
        {events?.length === 0 && <p className="settings-empty-notice">No permission changes recorded yet.</p>}
        {!!events?.length && (
          <ul className="permission-events">
            {events.map((entry, index) => (
              <li className="sharing-item permission-event-row" key={`${entry.occurredAt}-${index}`}>
                <div className="permission-event-header">
                  <div className="permission-event-action-group">
                    <span className={`state-pill ${entry.action.toLowerCase().includes('revoke') ? '' : 'is-active'}`}>
                      {entry.action.toUpperCase()}
                    </span>
                    <strong>{entry.action} · {entry.capability} / {entry.resource}</strong>
                  </div>
                  <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
                </div>
                <div className="permission-event-peer">
                  <span>Device: <span className="permission-peer-name">{pairedDeviceName(entry.fingerprint, names)}</span></span>
                  <code className="device-fingerprint-badge" title={entry.fingerprint}>
                    {entry.fingerprint.slice(0, 8)}…{entry.fingerprint.slice(-6)}
                  </code>
                </div>
                {entry.expiresAt && (
                  <p className="permission-event-expiry">
                    Grant expiry: <time dateTime={entry.expiresAt}>{new Date(entry.expiresAt).toLocaleString()}</time>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

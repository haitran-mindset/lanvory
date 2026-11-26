import { useEffect, useState } from 'react';
import { SelectField, accessDurations } from '../../components/ui/select';
import { z } from 'zod';
import { Ban, ChevronDown, ChevronUp, Monitor, Search, ShieldCheck } from 'lucide-react';
import { PanelHeading } from '../../components/panel-heading';
import { useNotifications } from '../../components/notifications';
import { pairedDeviceName, readPairedNames } from '../../services/paired-names';
import { readDefaultDuration } from '../../services/permission-defaults';

const durationSchema = z.enum(['until-revoked', 'hour', 'day']);

const peer = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
const schema = z.object({
  peers: z.array(peer),
  grants: z.array(peer.extend({ expiresAt: z.iso.datetime().optional(), inactive: z.boolean().optional() })),
});

async function readAccess() {
  const result = schema.safeParse(await window.lanvory.inboxAccess().catch(() => null));
  return result.success ? result.data : null;
}

export function InboxAccess({ ownerId }: { ownerId?: string }) {
  const { notify } = useNotifications();
  const [access, setAccess] = useState<z.infer<typeof schema> | null>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();
  const [names, setNames] = useState(() => ownerId ? readPairedNames(ownerId) : {});

  useEffect(() => {
    let active = true;
    void readAccess().then((result) => { if (active) setAccess(result); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ownerId) setNames(readPairedNames(ownerId));
  }, [ownerId]);

  async function update(fingerprint: string, allowed: boolean, duration?: z.infer<typeof durationSchema>) {
    setBusy(true);
    const saved = await window.lanvory.setInboxAccess(fingerprint, allowed, duration).catch(() => false);
    const device = pairedDeviceName(fingerprint, names);
    if (saved) {
      setMessage('');
      setEditing(undefined);
      notify({
        category: 'sharing',
        tone: allowed ? 'success' : 'info',
        title: allowed ? `${device} can now request to send files.` : `File requests from ${device} are blocked.`,
      });
    } else {
      setMessage('Unable to update who can send requests. Try again.');
    }
    setAccess(await readAccess());
    setBusy(false);
  }

  const search = query.trim().toLocaleLowerCase();
  const devices = (access?.peers ?? []).filter(({ fingerprint }) =>
    pairedDeviceName(fingerprint, names).toLocaleLowerCase().includes(search));
  const grants = new Map(access?.grants.map((grant) => [grant.fingerprint, grant]));

  return (
    <section id="file-request-access" className="operation-card" tabIndex={-1} aria-labelledby="inbox-access-heading">
      <PanelHeading icon={ShieldCheck} id="inbox-access-heading" title="Allow file requests" description="Choose which paired devices can ask to send files to this device. You approve each file in Incoming requests." />
      {access === undefined && <p>Loading paired devices and permissions…</p>}
      {access === null && <p role="status">Unable to load file request permissions.</p>}
      {access?.peers.length === 0 && <p className="panel-empty">Pair a device before allowing file requests.</p>}
      {!!access?.peers.length && (
        <label className="inbox-device-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Find a paired device" aria-label="Find a paired device" value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setEditing(undefined); }} />
        </label>
      )}
      {!!access?.peers.length && !devices.length && <p className="panel-empty" role="status">No devices match your search.</p>}
      {!!devices.length && <ul className="inbox-device-list">
        {devices.map(({ fingerprint }) => {
          const grant = grants.get(fingerprint);
          const deviceName = pairedDeviceName(fingerprint, names);
          const expandable = !grant || grant.inactive;
          const expanded = expandable && editing === fingerprint;
          return (
            <li className="inbox-device-item" key={fingerprint}>
              <div className="inbox-device-row">
                <div className="inbox-device-identity">
                  <Monitor size={18} aria-hidden="true" className="inbox-device-icon" />
                  <div className="inbox-device-info">
                    <div className="inbox-device-title-row">
                      <strong className="inbox-device-name">{deviceName}</strong>
                    </div>
                    <p className="inbox-device-status">
                      {grant?.inactive ? (
                        <span className="service-grant-badge">Permission expired</span>
                      ) : grant?.expiresAt ? (
                        <span className="inbox-status-allowed">Requests allowed until {new Date(grant.expiresAt).toLocaleString()}</span>
                      ) : grant ? (
                        <span className="inbox-status-allowed">Requests allowed</span>
                      ) : (
                        <span className="inbox-status-none">Requests blocked</span>
                      )}
                    </p>
                  </div>
                </div>
                {expandable ? (
                  <button type="button" className="refresh" aria-expanded={expanded} disabled={busy}
                    aria-label={`${expanded ? 'Hide options for' : 'Set permission for'} ${deviceName}`}
                    onClick={() => setEditing(expanded ? undefined : fingerprint)}>
                    {expanded ? 'Hide options' : 'Set permission'}
                    {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="refresh service-action-icon-btn inbox-revoke-btn"
                    title="Block requests"
                    aria-label={`Block requests from ${deviceName}`}
                    disabled={busy}
                    onClick={() => void update(fingerprint, false)}
                  ><Ban size={15} aria-hidden="true" /><span className="sr-only">Block requests</span></button>
                )}
              </div>

              {expanded && (
                <form className="trust-form inbox-grant-form" onSubmit={(event) => {
                  event.preventDefault();
                  const duration = durationSchema.safeParse(new FormData(event.currentTarget).get('duration'));
                  if (duration.success) void update(fingerprint, true, duration.data);
                }}>
                  <SelectField label="Allow requests for" name="duration" defaultValue={readDefaultDuration()} options={accessDurations} disabled={busy} />
                  <button type="submit" className="refresh" disabled={busy}>Allow requests</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

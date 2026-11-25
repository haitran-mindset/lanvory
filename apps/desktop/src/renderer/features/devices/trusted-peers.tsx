import { connectionError, PeerConnectionFields } from '../../components/peer-connection-fields';
import { Monitor, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';
import { PanelHeading } from '../../components/panel-heading';
import { pairedDeviceName, readPairedNames, writePairedNames } from '../../services/paired-names';

const fingerprintPattern = /^[0-9a-f]{64}$/i;
const peersSchema = z.array(z.object({
  fingerprint: z.string().regex(fingerprintPattern),
  verifiedAt: z.iso.datetime(),
}));

type Peers = z.infer<typeof peersSchema>;

export function TrustedPeers({ ownerId, externalRevision = 0, visible = true, searchQuery = '' }: {
  ownerId: string;
  externalRevision?: number;
  visible?: boolean;
  searchQuery?: string;
}) {
  const [peers, setPeers] = useState<Peers | null>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string>();
  const [message, setMessage] = useState('');
  const [editingName, setEditingName] = useState<string>();
  const [names, setNames] = useState(() => readPairedNames(ownerId));

  function saveName(event: FormEvent<HTMLFormElement>, fingerprint: string) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('deviceName') ?? '').trim();
    if (!name || name.length > 64) {
      setMessage('Enter a device name between 1 and 64 characters.');
      return;
    }
    const updated = { ...names, [fingerprint]: name };
    try {
      writePairedNames(ownerId, updated);
    } catch {
      setMessage('Unable to save the device name.');
      return;
    }
    setNames(updated);
    setEditingName(undefined);
    setMessage('Device name saved.');
  }

  useEffect(() => {
    if (!visible) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      const response = await window.lanvory.trustedPeers().catch(() => null);
      if (!current) return;
      const parsed = peersSchema.safeParse(response);
      setPeers(parsed.success ? parsed.data : null);
      timer = setTimeout(read, 5000);
    }
    void read();
    return () => { current = false; clearTimeout(timer); };
  }, [revision, externalRevision, visible]);

  async function update(action: () => Promise<boolean>, success: string, failure: string) {
    setBusy(true);
    setMessage('');
    try {
      const saved = await action();
      setMessage(saved ? success : failure);
      if (saved) {
        setPendingRevoke(undefined);
        setRevision((current) => current + 1);
      }
      return saved;
    } catch {
      setMessage(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const [connectionReady, setConnectionReady] = useState(false);
  const [formRevision, setFormRevision] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const adapter = String(values.get('adapter') ?? '').trim();
    const endpoint = String(values.get('endpoint') ?? '').trim();
    const fingerprint = String(values.get('fingerprint') ?? '').trim();
    const error = await connectionError(adapter, endpoint);
    if (error) {
      setMessage(error);
      return;
    }
    const saved = await update(
      () => window.lanvory.trustPeer(adapter, endpoint, fingerprint),
      'Peer identity verified and saved.',
      'Peer trust could not be saved. Check the endpoint, adapter approval and device ID.',
    );
    if (saved) { form.reset(); setFormRevision((value) => value + 1); }
  }

  const query = searchQuery.trim().toLocaleLowerCase();
  const filteredPeers = peers?.filter((item) =>
    !query
    || pairedDeviceName(item.fingerprint, names).toLocaleLowerCase().includes(query)
    || item.fingerprint.toLocaleLowerCase().includes(query),
  );

  return (
    <section className="nearby trusted-panel" aria-labelledby="trusted-heading" aria-busy={busy}>
      <PanelHeading icon={ShieldCheck} id="trusted-heading" title="Paired devices"
        action={!!peers?.length && <span className="tag">{peers.length}</span>} />
      {peers === undefined && <p>Loading paired devices…</p>}
      {peers === null && <p>Unable to load paired devices. <button type="button" className="refresh" onClick={() => setRevision(revision + 1)}>Retry</button></p>}
      {peers?.length === 0 && <p>No paired devices yet.</p>}
      {!!peers?.length && filteredPeers?.length === 0 && <p className="panel-empty">No paired devices match “{searchQuery.trim()}”.</p>}
      {!!filteredPeers?.length && (
        <ul className="interface-list paired-device-list">
          {filteredPeers.map((item) => (
            <li key={item.fingerprint} className="trusted-row">
              <div className="paired-device-main">
                <div className="paired-device-identity">
                  <div className="paired-device-icon-wrap">
                    <Monitor size={18} aria-hidden="true" />
                  </div>
                  <div className="paired-device-info">
                    <div className="paired-device-title-row">
                      <strong className="paired-device-name">{pairedDeviceName(item.fingerprint, names)}</strong>
                      <code className="device-fingerprint-badge" title={item.fingerprint}>
                        {item.fingerprint.slice(0, 8)}…{item.fingerprint.slice(-6)}
                      </code>
                    </div>
                    <small>Paired <time dateTime={item.verifiedAt}>{new Date(item.verifiedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time></small>
                  </div>
                </div>
                {!pendingRevoke && editingName !== item.fingerprint && (
                  <div className="paired-device-actions">
                    <button type="button" className="refresh" aria-label="Edit device name" title="Edit device name" disabled={busy} onClick={() => {
                      setMessage('');
                      setPendingRevoke(undefined);
                      setEditingName(item.fingerprint);
                    }}><Pencil size={15} aria-hidden="true" /></button>
                    <button type="button" className="refresh paired-device-remove" aria-label="Remove device" title="Remove device" disabled={busy} onClick={() => {
                      setEditingName(undefined);
                      setPendingRevoke(item.fingerprint);
                    }}><Trash2 size={15} aria-hidden="true" /></button>
                  </div>
                )}
              </div>
              {pendingRevoke === item.fingerprint && (
                <div className="trust-actions paired-device-confirm">
                  <p>Remove access for this device?</p>
                  <button type="button" className="refresh" disabled={busy} onClick={() => void update(
                    () => window.lanvory.revokePeer(item.fingerprint),
                    'Device removed.',
                    'Could not remove the device.',
                  )}>Confirm removal</button>
                  <button type="button" className="refresh" disabled={busy} onClick={() => setPendingRevoke(undefined)}>Cancel</button>
                </div>
              )}
              {editingName === item.fingerprint && (
                <form className="trust-form paired-device-name-form" onSubmit={(event) => saveName(event, item.fingerprint)}>
                  <label>Device name<input name="deviceName" maxLength={64} required
                    defaultValue={pairedDeviceName(item.fingerprint, names)}
                    placeholder="e.g. Office Mac" /></label>
                  <div className="paired-device-actions">
                    <button type="submit" className="primary">Save name</button>
                    <button type="button" className="refresh" onClick={() => setEditingName(undefined)}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <details className="trust-details">
        <summary>Verify by address</summary>
        <p>Ask the other device for its Device ID through a trusted channel.</p>
        <form className="trust-form" onSubmit={(event) => void submit(event)}>
          <PeerConnectionFields key={formRevision} disabled={busy} onReady={setConnectionReady} />
          <label>Device ID<input name="fingerprint" required maxLength={64} pattern="[A-Fa-f0-9]{64}" spellCheck={false} /></label>
          <button type="submit" className="refresh" disabled={busy || !connectionReady}>{busy ? 'Working…' : 'Verify and save trust'}</button>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

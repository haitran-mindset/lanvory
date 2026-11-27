import { Bluetooth, Check, Copy, Monitor, Pencil, Search, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useNotifications } from '../../components/notifications';
import { pairedDeviceName, readPairedNames, writePairedNames } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';

const fingerprintPattern = /^[0-9a-f]{64}$/i;
const peersSchema = z.array(z.object({
  fingerprint: z.string().regex(fingerprintPattern),
  verifiedAt: z.iso.datetime(),
}));

type Peers = z.infer<typeof peersSchema>;

export function TrustedPeers({ ownerId, externalRevision = 0, visible = true, routes }: {
  ownerId: string;
  externalRevision?: number;
  visible?: boolean;
  routes?: Record<string, PeerRoute>;
}) {
  const { notify } = useNotifications();
  const [peers, setPeers] = useState<Peers | null>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string>();
  const [message, setMessage] = useState('');
  const [editingName, setEditingName] = useState<string>();
  const [copied, setCopied] = useState<{ fingerprint: string; field: 'id' | 'address' }>();
  const copyTimer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const [searchQuery, setSearchQuery] = useState('');
  const [names, setNames] = useState(() => readPairedNames(ownerId));

  async function copyPeerValue(fingerprint: string, field: 'id' | 'address', value: string) {
    try {
      const ok = await window.lanvory.copyReceivedClipboard(value).catch(() => false);
      if (!ok) {
        await navigator.clipboard.writeText(value);
      }
      window.clearTimeout(copyTimer.current);
      setMessage('');
      setCopied({ fingerprint, field });
      copyTimer.current = window.setTimeout(() => setCopied(undefined), 1800);
    } catch {
      setMessage(field === 'id' ? 'Unable to copy the device ID.' : 'Unable to copy the address.');
    }
  }

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
    setMessage('');
    notify({
      category: 'pairing',
      tone: 'success',
      title: 'Device name saved.',
      body: name,
    });
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
      if (saved) {
        setPendingRevoke(undefined);
        setRevision((current) => current + 1);
        notify({ category: 'pairing', tone: 'success', title: success });
      } else {
        setMessage(failure);
      }
      return saved;
    } catch {
      setMessage(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const query = searchQuery.trim().toLocaleLowerCase();
  const discoveredName = (fingerprint: string) => {
    const route = routes?.[fingerprint];
    return route?.adapter === 'p2p' ? route.label?.trim() : undefined;
  };
  const displayName = (fingerprint: string) =>
    names[fingerprint] || discoveredName(fingerprint) || pairedDeviceName(fingerprint, names);
  const filteredPeers = peers?.filter((item) =>
    !query
    || displayName(item.fingerprint).toLocaleLowerCase().includes(query)
    || discoveredName(item.fingerprint)?.toLocaleLowerCase().includes(query)
    || pairedDeviceName(item.fingerprint, {}).toLocaleLowerCase().includes(query)
    || item.fingerprint.toLocaleLowerCase().includes(query),
  );

  return (
    <section className="nearby trusted-panel" aria-labelledby="trusted-heading" aria-busy={busy}>
      <div className="paired-register-heading">
        <div className="paired-register-title">
          <h3 id="trusted-heading">Paired devices</h3>
          {peers && <span className="paired-register-count" aria-label={`${peers.length} paired devices`}>{peers.length}</span>}
        </div>
        {peers && peers.length > 0 && (
          <label className="paired-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search by name or ID…"
              aria-label="Search paired devices"
            />
          </label>
        )}
      </div>
      {peers === undefined && <p>Loading paired devices…</p>}
      {peers === null && <p>Unable to load paired devices. <button type="button" className="refresh" onClick={() => setRevision(revision + 1)}>Retry</button></p>}
      {peers?.length === 0 && <p>No paired devices yet.</p>}
      {!!peers?.length && filteredPeers?.length === 0 && <p className="panel-empty">No paired devices match “{searchQuery.trim()}”.</p>}
      {!!filteredPeers?.length && (
        <ul className="interface-list paired-device-list">
          {filteredPeers.map((item) => {
            const route = routes?.[item.fingerprint];
            const endpoint = route?.endpoint;
            const name = displayName(item.fingerprint);
            const advertisedName = discoveredName(item.fingerprint);
            const isP2P = route?.adapter === 'p2p';
            const hasLan = Boolean(route?.adapter && !isP2P);
            return (
            <li key={item.fingerprint} className="trusted-row paired-device-card">
              <div className="paired-device-main">
                <div className="paired-device-identity">
                  <div className="paired-device-icon-wrap">
                    <Monitor size={20} aria-hidden="true" />
                  </div>
                  <div className="paired-device-info">
                    <div className="paired-device-title-row">
                      <strong className="paired-device-name">{name}</strong>
                      <span className={`paired-method-badge ${isP2P ? 'is-p2p' : hasLan ? 'is-lan' : ''}`}>
                        {isP2P ? <Bluetooth size={11} aria-hidden="true" /> : hasLan ? <Wifi size={11} aria-hidden="true" /> : <ShieldCheck size={11} aria-hidden="true" />}
                        <span>{isP2P ? 'Bluetooth + Wi-Fi P2P' : hasLan ? `Local Network (${route!.adapter})` : 'Verified device'}</span>
                      </span>
                    </div>
                    {advertisedName && advertisedName !== name && (
                      <small className="paired-bluetooth-name">
                        <Bluetooth size={13} aria-hidden="true" />
                        <span>Bluetooth name: <strong>{advertisedName}</strong></span>
                      </small>
                    )}
                    <div className="paired-device-meta-row">
                      <button
                        type="button"
                        className="device-fingerprint-badge device-fingerprint-copy"
                        title={`Copy full Device ID: ${item.fingerprint}`}
                        onClick={() => void copyPeerValue(item.fingerprint, 'id', item.fingerprint)}
                      >
                        <span>Device ID</span>
                        <code>{item.fingerprint.slice(0, 8)}…{item.fingerprint.slice(-6)}</code>
                        {copied?.fingerprint === item.fingerprint && copied.field === 'id' ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                      </button>
                      {endpoint && (
                        <button type="button" className="paired-meta-chip paired-address-copy"
                          aria-label={copied?.fingerprint === item.fingerprint && copied.field === 'address' ? 'Address copied' : `Copy address ${endpoint}`}
                          title="Copy address" onClick={() => void copyPeerValue(item.fingerprint, 'address', endpoint)}>
                          <span>Address</span>
                          <code>{endpoint}</code>
                          {copied?.fingerprint === item.fingerprint && copied.field === 'address'
                            ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                        </button>
                      )}
                      <small className="paired-date-text">
                        Paired <time dateTime={item.verifiedAt}>{new Date(item.verifiedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time>
                      </small>
                    </div>
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
                <div className="paired-device-confirm">
                  <p>Remove access for this device?</p>
                  <div className="paired-device-confirm-actions">
                    <button type="button" className="refresh paired-device-danger-btn" disabled={busy} onClick={() => void update(
                      () => window.lanvory.revokePeer(item.fingerprint),
                      'Device removed.',
                      'Could not remove the device.',
                    )}>Confirm removal</button>
                    <button type="button" className="refresh" disabled={busy} onClick={() => setPendingRevoke(undefined)}>Cancel</button>
                  </div>
                </div>
              )}
              {editingName === item.fingerprint && (
                <form className="paired-device-name-form" onSubmit={(event) => saveName(event, item.fingerprint)}>
                  <label className="paired-name-input-wrap">
                    <span className="sr-only">Device name</span>
                    <input name="deviceName" maxLength={64} required autoFocus
                      defaultValue={name}
                      placeholder="e.g. Office Mac" />
                  </label>
                  <div className="paired-device-form-actions">
                    <button type="submit" className="primary">Save name</button>
                    <button type="button" className="refresh" onClick={() => setEditingName(undefined)}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
            );
          })}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

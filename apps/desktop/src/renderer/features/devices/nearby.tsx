import { NearbyConnectionLabel } from './nearby-connection-label';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Bluetooth, CheckCircle2, ChevronRight, HelpCircle, Info, Laptop, Link2, Monitor, Radio, Radar, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { z } from 'zod';
import discoveryLanArt from '../../assets/discovery-lan.jpg';
import discoveryBleArt from '../../assets/discovery-ble.jpg';
import type { PeerRoute } from '../sharing/sharing';

const scanSchema = z.object({
  interfaces: z.array(z.string()),
  services: z.array(z.object({ name: z.string(), interface: z.string(), transport: z.enum(['tcp', 'udp']).optional() })),
  truncated: z.boolean(),
  unavailable: z.boolean().optional(),
});

type Scan = z.infer<typeof scanSchema>;

const resolutionSchema = z.object({
  name: z.string(),
  interface: z.string(),
  transport: z.literal('tcp'),
  endpoints: z.array(z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/)),
});

export type PairingTarget = { name: string; endpoints: string[] };

const blePeerSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  rssi: z.number(),
  transport: z.string(),
  p2pReady: z.boolean(),
  serviceName: z.string(),
  lastSeen: z.string(),
});

const bleStatusSchema = z.object({
  supported: z.boolean(),
  available: z.boolean(),
  bluetoothState: z.string(),
  advertising: z.boolean(),
  scanning: z.boolean(),
  p2pListening: z.boolean(),
  error: z.string().optional(),
});

const bleScanResultSchema = z.object({
  status: bleStatusSchema,
  peers: z.array(blePeerSchema).nullable().optional(),
});

type BleStatus = z.infer<typeof bleStatusSchema>;
type BlePeer = z.infer<typeof blePeerSchema>;
type BleFeedback = { tone: 'success' | 'info' | 'error'; text: string } | null;

const lanListenerSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('stopped'), adapter: z.string() }),
  z.object({ state: z.literal('listening'), adapter: z.string(), endpoint: z.string(), pairing: z.boolean() }),
]);
type LanListener = z.infer<typeof lanListenerSchema>;

const lanInterfacesSchema = z.array(z.object({
  name: z.string(),
  approved: z.boolean(),
  eligible: z.boolean(),
  addresses: z.array(z.string()),
}));

function btStateLabel(state: string) {
  switch (state) {
    case 'poweredOn': return 'Ready';
    case 'poweredOff': return 'Off';
    case 'unauthorized': return 'Permission needed';
    case 'unsupported': return 'macOS only';
    default: return 'Checking…';
  }
}

export function NearbyServices({ ready, scanRevision, trustRevision, searchQuery = '', onCount, onNetwork, onPair, onManualPair, onVerified }: {
  ready: boolean;
  scanRevision: number;
  trustRevision: number;
  searchQuery?: string;
  onVerified(route: PeerRoute): void;
  onCount(count?: number): void;
  onNetwork(): void;
  onPair(target: PairingTarget): void;
  onManualPair(): void;
}) {
  const [scanMode, setScanMode] = useState<'lan' | 'ble'>('lan');
  const [scan, setScan] = useState<Scan | null>();
  const [scanning, setScanning] = useState(false);
  const scanInFlight = useRef(false);
  const requestGeneration = useRef(0);

  const [bleStatus, setBleStatus] = useState<BleStatus | null>(null);
  const [blePeers, setBlePeers] = useState<BlePeer[]>([]);
  const [bleAction, setBleAction] = useState<'visibility' | 'scan' | 'connect' | null>(null);
  const bleBusy = bleAction !== null;
  const [bleFeedback, setBleFeedback] = useState<BleFeedback>(null);

  const [matched, setMatched] = useState<Record<string, number>>({});
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');
  const [lanListener, setLanListener] = useState<LanListener | null>(null);
  const [lanBusy, setLanBusy] = useState(false);
  const [lanError, setLanError] = useState('');

  useEffect(() => {
    if (!ready) return;
    void window.lanvory.listenerStatus().then((raw) => {
      const parsed = lanListenerSchema.safeParse(raw);
      if (parsed.success) setLanListener(parsed.data);
    }).catch(() => {});
  }, [ready]);

  async function toggleLanListener() {
    setLanBusy(true);
    setLanError('');
    try {
      if (lanListener?.state === 'listening') {
        const res = lanListenerSchema.safeParse(await window.lanvory.setListener('stop', lanListener.adapter).catch(() => null));
        if (res.success) {
          setLanListener(res.data);
        } else {
          setLanError('Could not turn off LAN listener.');
        }
        return;
      }

      const rawIfaces = await window.lanvory.interfaces().catch(() => null);
      const ifaces = lanInterfacesSchema.safeParse(rawIfaces);
      if (!ifaces.success) {
        setLanError('Unable to read local network adapters.');
        return;
      }
      const candidates = ifaces.data
        .filter((nic) => nic.eligible)
        .sort((a, b) => Number(b.approved) - Number(a.approved));
      let chosenAdapter = '';
      let chosenAddress = '';
      for (const nic of candidates) {
        const ipv4 = nic.addresses.map((cidr) => cidr.split('/')[0]).find((addr) => z.ipv4().safeParse(addr).success);
        if (ipv4) {
          chosenAdapter = nic.name;
          chosenAddress = ipv4;
          if (!nic.approved) {
            const approved = await window.lanvory.setInterfaceApproval(nic.name, true).catch(() => false);
            if (!approved) {
              setLanError(`Could not approve ${nic.name}.`);
              return;
            }
          }
          break;
        }
      }
      if (!chosenAdapter || !chosenAddress) {
        onNetwork();
        return;
      }

      let port = 0;
      let pairing = true;
      try {
        const saved = JSON.parse(localStorage.getItem('lanvory.connection-settings') ?? '{}');
        if (typeof saved?.port === 'number' && saved.port >= 0 && saved.port <= 65535) port = saved.port;
        if (typeof saved?.pairing === 'boolean') pairing = saved.pairing;
      } catch {
        // Use defaults
      }
      const res = lanListenerSchema.safeParse(
        await window.lanvory.setListener('start', chosenAdapter, `${chosenAddress}:${port}`, pairing).catch(() => null),
      );
      if (res.success) {
        setLanListener(res.data);
        if (res.data.state !== 'listening') {
          setLanError('Could not start LAN listener on the selected adapter.');
        }
      } else {
        setLanError('Could not turn on LAN listener.');
      }
    } finally {
      setLanBusy(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    void window.lanvory.nearbyStatus().then((raw) => {
      const parsed = bleScanResultSchema.safeParse(raw);
      if (parsed.success) {
        setBleStatus(parsed.data.status);
        setBlePeers(parsed.data.peers ?? []);
      }
    }).catch(() => {});
  }, [ready]);

  async function toggleAdvertise() {
    if (!bleStatus) return;
    setBleAction('visibility');
    setBleFeedback(null);
    try {
      const raw = await window.lanvory.nearbyAdvertise(!bleStatus.advertising).catch(() => null);
      const parsed = bleStatusSchema.safeParse(raw);
      if (parsed.success) {
        setBleStatus(parsed.data);
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setBleFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBleAction(null);
    }
  }

  async function runBleScan() {
    setBleAction('scan');
    setBleFeedback(null);
    try {
      const raw = await window.lanvory.nearbyScan().catch(() => null);
      const parsed = bleScanResultSchema.safeParse(raw);
      if (parsed.success) {
        setBleStatus(parsed.data.status);
        const found = parsed.data.peers ?? [];
        setBlePeers(found);
        if (found.length === 0) {
          setBleFeedback({
            tone: 'info',
            text: 'No devices found nearby. Turn on “Discoverable” on the other device and scan again.',
          });
        }
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setBleFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBleAction(null);
    }
  }

  async function connectBlePeer(peer: BlePeer) {
    setBleAction('connect');
    setBleFeedback(null);
    try {
      const raw = await window.lanvory.nearbyConnect(peer.serviceName).catch(() => null);
      const parsed = z.object({
        endpoint: z.string(),
        serviceName: z.string(),
        fingerprint: z.string().optional(),
        trusted: z.boolean().optional(),
      }).safeParse(raw);
      if (parsed.success && parsed.data.endpoint) {
        const { endpoint, fingerprint, trusted } = parsed.data;
        if (fingerprint && trusted) {
          onVerified({ fingerprint, adapter: 'p2p', endpoint, label: peer.name });
          setBleFeedback({
            tone: 'success',
            text: `Direct connection ready for ${peer.name}.`,
          });
        } else if (fingerprint) {
          const pairRes = await window.lanvory.nearbyPair(endpoint, fingerprint).catch(() => ({ ok: false, error: 'Pairing failed.' }));
          if (pairRes.ok) {
            onVerified({ fingerprint, adapter: 'p2p', endpoint, label: peer.name });
            setBleFeedback({
              tone: 'success',
              text: `Paired with ${peer.name} over Wi-Fi P2P.`,
            });
          } else {
            setBleFeedback({ tone: 'error', text: pairRes.error || 'Unable to start pairing over Wi-Fi P2P.' });
          }
        } else {
          onPair({ name: peer.name, endpoints: [endpoint] });
          setBleFeedback({
            tone: 'info',
            text: `The Wi-Fi P2P link to ${peer.name} is ready. Waiting for device verification.`,
          });
        }
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setBleFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBleAction(null);
    }
  }

  useLayoutEffect(() => () => {
    requestGeneration.current += 1;
    onCount(undefined);
  }, [onCount]);

  async function selectPeer(adapter: string, name: string) {
    const generation = requestGeneration.current;
    setResolving(true);
    setResolutionError('');
    const response = await window.lanvory.resolveDiscovery(adapter, name).catch(() => null);
    if (generation !== requestGeneration.current) return;
    const result = resolutionSchema.safeParse(response);
    if (!result.success || result.data.interface !== adapter || result.data.name !== name || !result.data.endpoints.length) {
      setResolving(false);
      setResolutionError('No eligible address found for this service. Scan again or enter an endpoint manually.');
      return;
    }
    for (const endpoint of result.data.endpoints.slice(0, 3)) {
      const fingerprint = await window.lanvory.matchTrustedPeer(adapter, endpoint).catch(() => null);
      if (generation !== requestGeneration.current) return;
      if (fingerprint) {
        onVerified({ fingerprint, adapter, endpoint });
        setMatched((previous) => ({ ...previous, [JSON.stringify([adapter, name])]: trustRevision }));
        setResolving(false);
        return;
      }
    }
    setResolving(false);
    onPair({ name, endpoints: result.data.endpoints });
    document.getElementById('pairing-heading')?.focus();
  }

  async function discover() {
    if (scanInFlight.current) return;
    const generation = ++requestGeneration.current;
    setResolving(false);
    scanInFlight.current = true;
    setScanning(true);
    setResolutionError('');
    setScan(undefined);
    setMatched({});
    onCount(undefined);
    const response = await window.lanvory.discover().catch(() => null);
    if (generation !== requestGeneration.current) return;
    const parsed = scanSchema.safeParse(response);
    setScan(parsed.success ? parsed.data : null);
    onCount(parsed.success && !parsed.data.unavailable ? parsed.data.services.filter((service) => service.transport !== 'udp').length : undefined);
    scanInFlight.current = false;
    setScanning(false);
  }

  const lastScan = useRef(0);
  useEffect(() => {
    if (!ready || lastScan.current === scanRevision) return;
    lastScan.current = scanRevision;
    void discover();
  }, [ready, scanRevision]);

  const allDevices = scan?.services.filter((service) => service.transport !== 'udp') ?? [];
  const query = searchQuery.trim().toLocaleLowerCase();
  const devices = query
    ? allDevices.filter((service) => service.name.toLocaleLowerCase().includes(query) || service.interface.toLocaleLowerCase().includes(query))
    : allDevices;
  const heading = allDevices.length === 0 ? 'Device discovery'
    : allDevices.length === 1 ? '1 device found' : `${allDevices.length} devices found`;
  const needsNetwork = scan?.interfaces.length === 0;
  const showManualPair = ready && !needsNetwork && !scanning && !resolving &&
    (scan === null || (scan !== undefined && allDevices.length === 0) || Boolean(resolutionError));

  const filteredBlePeers = query
    ? blePeers.filter((p) => p.name.toLowerCase().includes(query) || p.serviceName.toLowerCase().includes(query))
    : blePeers;
  const btReady = bleStatus?.bluetoothState === 'poweredOn';

  return (
    <section className="nearby directory-discovery device-discovery-panel" aria-labelledby="nearby-title" aria-busy={scanning || bleBusy}>
      <div className="nearby-heading">
        <div className="device-discovery-heading">
          <span className="device-discovery-emblem">
            <Radar size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="panel-heading-title-row">
              <h3 id="nearby-title" tabIndex={-1}>Device Discovery</h3>
              {scanMode === 'lan' && allDevices.length > 0 && (
                <span className="tag">{allDevices.length}</span>
              )}
              {scanMode === 'ble' && blePeers.length > 0 && (
                <span className="tag">{blePeers.length}</span>
              )}
            </div>
            <p>Choose a discovery method to find and connect to nearby devices.</p>
          </div>
        </div>
      </div>

      <div className="discovery-method-stack" role="radiogroup" aria-label="Discovery method">
        <button
          type="button"
          role="radio"
          aria-checked={scanMode === 'lan'}
          className={`discovery-method-card ${scanMode === 'lan' ? 'is-selected' : ''}`}
          onClick={() => setScanMode('lan')}
        >
          <div className="discovery-method-visual" aria-hidden="true">
            <img src={discoveryLanArt} alt="" className="discovery-art-img" />
            <span className="discovery-method-scrim" />
          </div>
          <span className="discovery-method-radio" aria-hidden="true" />
          <div className="discovery-method-head">
            <span className="discovery-method-icon">
              <Wifi size={18} aria-hidden="true" />
            </span>
            <div className="discovery-method-copy">
              <strong>Local Network</strong>
              <small>Ethernet or Wi‑Fi subnet.</small>
            </div>
          </div>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={scanMode === 'ble'}
          className={`discovery-method-card ${scanMode === 'ble' ? 'is-selected' : ''}`}
          onClick={() => setScanMode('ble')}
        >
          <div className="discovery-method-visual" aria-hidden="true">
            <img src={discoveryBleArt} alt="" className="discovery-art-img" />
            <span className="discovery-method-scrim" />
          </div>
          <span className="discovery-method-radio" aria-hidden="true" />
          <div className="discovery-method-head">
            <span className="discovery-method-icon">
              <Bluetooth size={18} aria-hidden="true" />
            </span>
            <div className="discovery-method-copy">
              <strong>
                Bluetooth + P2P
                {bleStatus && (
                  <span
                    className={`ble-ready-dot ${btReady ? 'is-ready' : ''}`}
                    title={`Bluetooth: ${btStateLabel(bleStatus.bluetoothState)}`}
                    aria-hidden="true"
                  />
                )}
              </strong>
              <small>Direct link without shared Wi‑Fi.</small>
            </div>
          </div>
        </button>
      </div>

      {scanMode === 'lan' && (
        <>
          <div className="ble-action-bar device-discovery-visibility">
            <div className="device-discovery-visibility-copy">
              <Wifi size={17} aria-hidden="true" />
              <div>
                <strong>Local network visibility</strong>
                <small>
                  {lanListener?.state === 'listening'
                    ? `Listening on ${lanListener.endpoint} (${lanListener.adapter})`
                    : 'Turn on LAN so nearby devices can find and connect to this device.'}
                </small>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={lanListener?.state === 'listening'}
              className={`ble-switch-btn ${lanListener?.state === 'listening' ? 'is-on' : ''}`}
              disabled={!ready || lanBusy}
              onClick={() => void toggleLanListener()}
            >
              <span className="ble-switch-track" aria-hidden="true">
                <span className="ble-switch-thumb" />
              </span>
              <span>{lanListener?.state === 'listening' ? 'LAN On' : 'Turn on LAN'}</span>
            </button>
          </div>
          {lanError && (
            <div className="sync-feedback-banner device-discovery-feedback is-error" role="status" style={{ marginTop: 8 }}>
              <AlertCircle size={15} aria-hidden="true" />
              <span>{lanError}</span>
            </div>
          )}
        </>
      )}

      {scanMode === 'ble' && bleStatus?.available && (
        <div className="ble-action-bar device-discovery-visibility">
          <div className="device-discovery-visibility-copy">
            <Radio size={17} aria-hidden="true" />
            <div>
              <strong>Device visibility</strong>
              <small>Control whether this device can be discovered by nearby devices.</small>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={bleStatus?.advertising === true}
            className={`ble-switch-btn ${bleStatus?.advertising ? 'is-on' : ''}`}
            disabled={bleBusy || !bleStatus?.available}
            onClick={() => void toggleAdvertise()}
          >
            <span className="ble-switch-track" aria-hidden="true">
              <span className="ble-switch-thumb" />
            </span>
            <span>Discoverable</span>
          </button>
        </div>
      )}

      <div className="discovery-footer-actions">
        {scanMode === 'lan' ? (
          !needsNetwork && !scan?.unavailable && (
            <button type="button" className="primary discovery-scan-full-btn" disabled={!ready || scanning || resolving} onClick={() => void discover()}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>{scanning ? 'Scanning…' : 'Scan for Devices'}</span>
            </button>
          )
        ) : (
          <button type="button" className="primary discovery-scan-full-btn" disabled={!ready || bleBusy || !bleStatus?.available} onClick={() => void runBleScan()}>
            <RefreshCw size={15} aria-hidden="true" />
            <span>{bleAction === 'scan' ? 'Scanning…' : 'Scan for Devices'}</span>
          </button>
        )}
      </div>

      {scanMode === 'ble' ? (
        <div className="device-discovery-body">
          {bleStatus && !bleStatus.available && (
            <p className="directory-empty">{bleStatus.error || 'Bluetooth discovery is unavailable on this platform.'}</p>
          )}

          {bleFeedback && (
            <div className={`sync-feedback-banner device-discovery-feedback is-${bleFeedback.tone}`} role="status">
              {bleFeedback.tone === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : bleFeedback.tone === 'error' ? <AlertCircle size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
              <span>{bleFeedback.text}</span>
            </div>
          )}

          {filteredBlePeers.length > 0 ? (
            <ul className="nearby-devices device-discovery-results" aria-label="Nearby Bluetooth devices">
              {filteredBlePeers.map((peer) => (
                <li key={peer.id}>
                  <span className="device-discovery-peer-icon"><Laptop size={19} aria-hidden="true" /></span>
                  <div className="device-discovery-peer-copy">
                    <strong className="service-name" title={peer.name}>{peer.name}</strong>
                    <NearbyConnectionLabel peer={peer} />
                  </div>
                  <button
                    type="button"
                    className="primary pair-device-action"
                    disabled={!ready || bleBusy}
                    onClick={() => void connectBlePeer(peer)}
                  >
                    Connect <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !bleFeedback && (
              <p className="directory-empty">
                <Bluetooth size={18} aria-hidden="true" /> Click Scan Bluetooth to find nearby devices without a shared network.
              </p>
            )
          )}
        </div>
      ) : (
        <>
      <div role="status">
        {scan === undefined && !scanning && <p className="directory-empty"><Radar size={18} aria-hidden="true" /> Click Scan LAN to find devices on your local network (Ethernet or Wi-Fi).</p>}
        {scan === null && <p>Discovery failed. Check the daemon and try again.</p>}
        {scan?.unavailable && !needsNetwork && <p className="directory-empty">Automatic discovery isn’t available here. You can pair using the other device’s address.</p>}
        {scan && !scan.unavailable && !needsNetwork && allDevices.length > 0 && devices.length === 0 && (
          <p className="directory-empty">No nearby devices match “{searchQuery.trim()}”.</p>
        )}
        {scan && !scan.unavailable && !needsNetwork && allDevices.length === 0 && (
          <div className="discovery-empty-guide">
            <div className="discovery-empty-hero">
              <div className="discovery-radar-graphic">
                <div className="radar-ring ring-3" />
                <div className="radar-ring ring-2" />
                <div className="radar-ring ring-1" />
                <div className="radar-icon-center">
                  <Radar size={28} className={scanning ? 'radar-sweep' : ''} aria-hidden="true" />
                </div>
              </div>
              <h4 className="discovery-empty-title">
                {scanning ? 'Searching for nearby devices…' : 'No devices found nearby'}
              </h4>
              <p className="discovery-empty-desc">
                {scanning
                  ? 'Listening for local Bonjour and mDNS announcements on your network.'
                  : 'Make sure Lanvory is open on your other computer connected to the same Wi‑Fi.'}
              </p>
            </div>

            <details className="discovery-troubleshoot-details">
              <summary>
                <HelpCircle size={14} aria-hidden="true" />
                <span>Troubleshooting checklist & network requirements</span>
                <ChevronRight size={14} aria-hidden="true" className="discovery-troubleshoot-chevron" />
              </summary>
              <div className="discovery-troubleshoot-body">
                <p>Lanvory uses local multicast DNS (mDNS) over UDP port 5353.</p>
                <ul>
                  <li>Confirm that local network traffic (UDP port 5353) is not blocked by a local firewall.</li>
                  <li>Guest Wi‑Fi networks often enable client isolation, preventing devices from seeing each other.</li>
                  <li>If automatic discovery is unavailable on this network, you can still pair directly using <strong>Pair by address</strong> below.</li>
                </ul>
              </div>
            </details>
          </div>
        )}
        {resolving && <p>Resolving the selected service…</p>}
        {resolutionError && <p>{resolutionError}</p>}
        {scan?.truncated && <p>The scan reached its result limit.</p>}
      </div>
      {showManualPair && (
        <button type="button" className="directory-manual" onClick={onManualPair}>
          <span className="directory-manual-leading">
            <span className="directory-manual-icon" aria-hidden="true">
              <Link2 size={15} />
            </span>
            <span className="directory-manual-copy">
              <strong>Pair by address</strong>
              <small>Connect manually using IP or hostname</small>
            </span>
          </span>
          <ChevronRight size={16} className="directory-manual-arrow" aria-hidden="true" />
        </button>
      )}
      {needsNetwork && (
        <div className="discovery-setup">
          <span className="panel-icon discovery-setup-icon"><Wifi size={24} aria-hidden="true" /></span>
          <div role="status">
            <h4>Set up your local network</h4>
            <p>Choose the Wi‑Fi or Ethernet connection Lanvory can use to connect to nearby devices.</p>
          </div>
          <button type="button" className="primary" onClick={onNetwork}>
            Set up local network <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <ul className="nearby-devices lan-discovery-list" aria-label="Nearby LAN devices">
          {devices.map((service) => {
            const paired = matched[JSON.stringify([service.interface, service.name])] === trustRevision;
            const discoveryCode = /^Lanvory ([a-f0-9]{16})$/.exec(service.name)?.[1];
            return (
              <li key={JSON.stringify([service.interface, service.name, service.transport])}>
                <Monitor className="lan-discovery-icon" size={19} aria-hidden="true" />
                <div className="lan-discovery-device">
                  <strong className="service-name">{discoveryCode ? 'LANVORY' : service.name}</strong>
                  {discoveryCode && <code aria-label={`Discovery code ${discoveryCode}`}>{discoveryCode}</code>}
                </div>
                {paired ? (
                  <span className="lan-discovery-paired"><CheckCircle2 size={15} aria-hidden="true" /> Paired</span>
                ) : (
                  <button type="button" className="primary pair-device-action" disabled={!ready || resolving}
                    aria-label={`Pair with ${service.name} on ${service.interface}`}
                    onClick={() => void selectPeer(service.interface, service.name)}>Pair device <ChevronRight size={15} aria-hidden="true" /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}
    </section>
  );
}

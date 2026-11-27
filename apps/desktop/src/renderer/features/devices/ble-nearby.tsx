import { NearbyConnectionLabel } from './nearby-connection-label';
import { useEffect, useState } from 'react';
import { AlertCircle, Bluetooth, CheckCircle2, Info, Radar, RefreshCw, Wifi } from 'lucide-react';
import { z } from 'zod';
import type { PairingTarget } from './nearby';

const nearbyPeerSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  rssi: z.number(),
  transport: z.string(),
  p2pReady: z.boolean(),
  serviceName: z.string(),
  lastSeen: z.string(),
});

const nearbyStatusSchema = z.object({
  supported: z.boolean(),
  available: z.boolean(),
  bluetoothState: z.string(),
  advertising: z.boolean(),
  scanning: z.boolean(),
  p2pListening: z.boolean(),
  error: z.string().optional(),
});

const nearbyScanResultSchema = z.object({
  status: nearbyStatusSchema,
  peers: z.array(nearbyPeerSchema).nullable().optional(),
});

type NearbyStatus = z.infer<typeof nearbyStatusSchema>;
type NearbyPeer = z.infer<typeof nearbyPeerSchema>;
type BleFeedback = { tone: 'success' | 'info' | 'error'; text: string } | null;

function btStateLabel(state: string) {
  switch (state) {
    case 'poweredOn': return 'Ready';
    case 'poweredOff': return 'Bluetooth Off';
    case 'unauthorized': return 'Permission Needed';
    case 'unsupported': return 'macOS Only';
    default: return 'Checking…';
  }
}

function BleBanner({ feedback }: { feedback: BleFeedback }) {
  if (!feedback) return null;
  const Icon = feedback.tone === 'success' ? CheckCircle2 : feedback.tone === 'error' ? AlertCircle : Info;
  return (
    <div className={`sync-feedback-banner is-${feedback.tone}`} role="status">
      <Icon size={15} aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  );
}

export function BleNearbyCard({
  visible,
  searchQuery = '',
  onScanLan,
  onConnectP2P,
}: {
  visible: boolean;
  searchQuery?: string;
  onScanLan(): void;
  onConnectP2P(target: PairingTarget): void;
}) {
  const [scanMode, setScanMode] = useState<'lan' | 'ble'>('ble');
  const [status, setStatus] = useState<NearbyStatus | null>(null);
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<BleFeedback>(null);

  async function loadStatus() {
    const raw = await window.lanvory.nearbyStatus().catch(() => null);
    const parsed = nearbyScanResultSchema.safeParse(raw);
    if (parsed.success) {
      setStatus(parsed.data.status);
      setPeers(parsed.data.peers ?? []);
    }
  }

  useEffect(() => {
    if (!visible) return;
    void loadStatus();
  }, [visible]);

  async function toggleAdvertise() {
    if (!status) return;
    setBusy(true);
    setFeedback(null);
    try {
      const next = !status.advertising;
      const raw = await window.lanvory.nearbyAdvertise(next).catch(() => null);
      const parsed = nearbyStatusSchema.safeParse(raw);
      if (parsed.success) {
        setStatus(parsed.data);
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function runBleScan() {
    setBusy(true);
    setFeedback(null);
    try {
      const raw = await window.lanvory.nearbyScan().catch(() => null);
      const parsed = nearbyScanResultSchema.safeParse(raw);
      if (parsed.success) {
        setStatus(parsed.data.status);
        const found = parsed.data.peers ?? [];
        setPeers(found);
        if (found.length === 0) {
          setFeedback({
            tone: 'info',
            text: 'No Macs found nearby. Turn on “Discoverable” on the other Mac and scan again.',
          });
        }
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function connectPeer(peer: NearbyPeer) {
    setBusy(true);
    setFeedback(null);
    try {
      const raw = await window.lanvory.nearbyConnect(peer.serviceName).catch(() => null);
      const parsed = z.object({ endpoint: z.string(), serviceName: z.string() }).safeParse(raw);
      if (parsed.success && parsed.data.endpoint) {
        onConnectP2P({ name: peer.name, endpoints: [parsed.data.endpoint] });
        setFeedback({
          tone: 'success',
          text: `Direct link ready for ${peer.name}. Confirm verification below to pair.`,
        });
      } else if (raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string') {
        setFeedback({ tone: 'error', text: raw.error });
      }
    } finally {
      setBusy(false);
    }
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredPeers = query
    ? peers.filter((p) => p.name.toLowerCase().includes(query) || p.serviceName.toLowerCase().includes(query))
    : peers;

  const btReady = status?.bluetoothState === 'poweredOn';

  return (
    <section className="ble-nearby-card" aria-label="Find Devices">
      <div className="ble-nearby-header">
        <div className="ble-nearby-brand">
          <span className="panel-icon"><Radar size={19} aria-hidden="true" /></span>
          <div className="ble-nearby-copy">
            <div className="ble-nearby-title-row">
              <h3>Find Devices</h3>
            </div>
            <p>Choose how you want to scan for devices to pair or connect.</p>
          </div>
        </div>
      </div>

      <div className="ble-scan-options" role="radiogroup" aria-label="Scan method">
        <button
          type="button"
          role="radio"
          aria-checked={scanMode === 'lan'}
          className={`ble-scan-option ${scanMode === 'lan' ? 'is-active' : ''}`}
          onClick={() => {
            setScanMode('lan');
            setFeedback(null);
          }}
        >
          <span className="ble-scan-option-icon"><Wifi size={17} aria-hidden="true" /></span>
          <span className="ble-scan-option-copy">
            <span className="ble-scan-option-title">
              <strong>Same Wi-Fi (LAN)</strong>
            </span>
            <small>Scan devices connected to the same Wi-Fi or Ethernet router.</small>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={scanMode === 'ble'}
          className={`ble-scan-option ${scanMode === 'ble' ? 'is-active' : ''}`}
          onClick={() => {
            setScanMode('ble');
            setFeedback(null);
          }}
        >
          <span className="ble-scan-option-icon"><Bluetooth size={17} aria-hidden="true" /></span>
          <span className="ble-scan-option-copy">
            <span className="ble-scan-option-title">
              <strong>Nearby (Bluetooth + P2P)</strong>
              {status && (
                <span className={btReady ? 'state-pill is-active' : 'state-pill'}>
                  {btStateLabel(status.bluetoothState)}
                </span>
              )}
            </span>
            <small>Find nearby Macs over Bluetooth & connect directly—no router needed.</small>
          </span>
        </button>
      </div>

      {scanMode === 'lan' ? (
        <div className="ble-action-bar">
          <span className="ble-action-hint">
            Scans your approved local network adapters for Lanvory devices.
          </span>
          <button type="button" className="primary" onClick={onScanLan}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Scan Wi-Fi</span>
          </button>
        </div>
      ) : (
        <>
          <div className="ble-action-bar">
            <span className="ble-action-hint">
              {status?.advertising
                ? 'This Mac is visible to nearby Bluetooth scans.'
                : 'Turn on Discoverable so other Macs can find this device.'}
            </span>
            <div className="ble-controls">
              <button
                type="button"
                role="switch"
                aria-checked={status?.advertising === true}
                className={`ble-switch-btn ${status?.advertising ? 'is-on' : ''}`}
                disabled={busy || !status?.available}
                onClick={() => void toggleAdvertise()}
              >
                <span className="ble-switch-track" aria-hidden="true">
                  <span className="ble-switch-thumb" />
                </span>
                <span>Discoverable</span>
              </button>

              <button
                type="button"
                className="primary"
                disabled={busy || !status?.available}
                onClick={() => void runBleScan()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>{busy ? 'Scanning…' : 'Scan Bluetooth'}</span>
              </button>
            </div>
          </div>

          {status && !status.available && (
            <p className="panel-empty">{status.error || 'Bluetooth discovery is not available on this device.'}</p>
          )}
          <BleBanner feedback={feedback} />

          {filteredPeers.length > 0 && (
            <ul className="ble-peers-grid">
              {filteredPeers.map((peer) => (
                <li key={peer.id} className="ble-peer-card">
                  <div className="ble-peer-meta">
                    <strong>{peer.name}</strong>
                    <NearbyConnectionLabel peer={peer} />
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void connectPeer(peer)}
                  >
                    <Wifi size={14} aria-hidden="true" />
                    <span>Connect</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

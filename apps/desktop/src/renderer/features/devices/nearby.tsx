import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, HelpCircle, Laptop, Monitor, Radar, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { z } from 'zod';
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
  const [scan, setScan] = useState<Scan | null>();
  const [scanning, setScanning] = useState(false);
  const scanInFlight = useRef(false);
  const requestGeneration = useRef(0);

  const [matched, setMatched] = useState<Record<string, number>>({});
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');

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

  return (
    <section className="nearby directory-discovery" aria-labelledby="nearby-title" aria-busy={scanning}>
      <div className="nearby-heading">
        <h3 id="nearby-title" tabIndex={-1}>{heading}</h3>
        {!needsNetwork && !scan?.unavailable && (
          <button type="button" className="refresh" disabled={!ready || scanning || resolving} onClick={() => void discover()}>
            <RefreshCw size={15} aria-hidden="true" /> {scanning ? 'Searching…' : scan === undefined ? 'Scan' : 'Scan again'}
          </button>
        )}
      </div>
      <div role="status">
        {scan === undefined && !scanning && <p className="directory-empty"><Radar size={18} aria-hidden="true" /> Use Pair Device to find another device on this network.</p>}
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

            <div className="discovery-steps-grid">
              <div className="discovery-step-card">
                <div className="discovery-step-icon">
                  <Wifi size={17} aria-hidden="true" />
                </div>
                <div className="discovery-step-content">
                  <strong>Same Wi‑Fi or LAN</strong>
                  <span>Both devices must be on the same local network subnet.</span>
                </div>
              </div>
              <div className="discovery-step-card">
                <div className="discovery-step-icon">
                  <Laptop size={17} aria-hidden="true" />
                </div>
                <div className="discovery-step-content">
                  <strong>Keep Lanvory open</strong>
                  <span>Ensure Lanvory is active on your other device to be found.</span>
                </div>
              </div>
              <div className="discovery-step-card">
                <div className="discovery-step-icon">
                  <ShieldCheck size={17} aria-hidden="true" />
                </div>
                <div className="discovery-step-content">
                  <strong>Direct & Private</strong>
                  <span>100% peer-to-peer. Zero cloud servers or accounts needed.</span>
                </div>
              </div>
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
        <button type="button" className="refresh directory-manual" onClick={onManualPair}>
          <span>Pair by address</span>
          <ArrowRight size={14} aria-hidden="true" />
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
        <ul className="nearby-devices">
          {devices.map((service) => {
            const paired = matched[JSON.stringify([service.interface, service.name])] === trustRevision;
            return (
              <li key={JSON.stringify([service.interface, service.name, service.transport])}>
                <span className="panel-icon"><Monitor size={20} aria-hidden="true" /></span>
                <div><strong className="service-name">{service.name}</strong><small>{paired ? 'Paired' : 'Ready to verify'}</small></div>
                {!paired && <button type="button" className="primary pair-device-action" disabled={!ready || resolving}
                    aria-label={`Pair with ${service.name} on ${service.interface}`}
                    onClick={() => void selectPeer(service.interface, service.name)}>Pair device <ChevronRight size={15} aria-hidden="true" /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

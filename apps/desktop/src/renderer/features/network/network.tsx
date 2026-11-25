import { type FormEvent, useEffect, useRef, useState } from 'react';
import { SelectField } from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';

import { Activity, AlertCircle, ChevronDown, Copy, Info, Loader2, Network, RefreshCw, Wifi, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { readInterfaces, type Interfaces } from '../../services/network-interfaces';
import { PanelHeading } from '../../components/panel-heading';
import { useNotifications } from '../../components/notifications';
import { NetworkExplorer } from './explorer';
import type { PeerRoute } from '../sharing/sharing';

const scanSchema = z.object({
  services: z.array(z.object({ name: z.string(), interface: z.string(), transport: z.enum(['tcp', 'udp']).optional() })),
  unavailable: z.boolean().optional(),
});

const resolutionSchema = z.object({
  name: z.string(),
  interface: z.string(),
  endpoints: z.array(z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/)),
});

const listenerSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('local-only') }),
  z.object({ state: z.literal('stopped'), adapter: z.string() }),
  z.object({ state: z.literal('listening'), adapter: z.string(), endpoint: z.string(), pairing: z.boolean() }),
]);

async function readListenerStatus() {
  const parsed = listenerSchema.safeParse(await window.lanvory.listenerStatus().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const scopeSchema = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true), source: z.string(), subnet: z.string() }),
  z.object({ allowed: z.literal(false), reason: z.string() }),
]);

const deniedReasons: Record<string, string> = {
  destination_outside_lan_ranges: 'The address is outside the supported LAN ranges.',
  interface_not_active_and_approved: 'The adapter must be active and approved.',
  destination_is_local_address: 'The address belongs to this device.',
  destination_outside_interface_subnet: 'The address is outside the adapter’s subnet.',
  destination_is_network_or_broadcast: 'The address identifies a subnet or broadcast destination.',
};

const connectionSettingsKey = 'lanvory.connection-settings';
const connectionSettingsSchema = z.object({ port: z.number().int().min(0).max(65535), pairing: z.boolean() });
type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;

function readConnectionSettings(): ConnectionSettings {
  const defaults = { port: 43110, pairing: true };
  try {
    const stored = JSON.parse(localStorage.getItem(connectionSettingsKey) ?? 'null');
    return connectionSettingsSchema.safeParse(stored).data ?? defaults;
  } catch {
    return defaults;
  }
}

export function NetworkPanel({ visible, deviceName, routes, onRoute }: {
  visible: boolean;
  deviceName?: string;
  routes?: Record<string, PeerRoute>;
  onRoute?(route: PeerRoute): void;
}) {
  const detectGeneration = useRef(0);
  const [interfaces, setInterfaces] = useState<Interfaces | null>();
  const [listener, setListener] = useState<z.infer<typeof listenerSchema> | null>();
  const [trustedPeers, setTrustedPeers] = useState<Array<{ fingerprint: string; verifiedAt: string }> | null>();
  const [listenerBusy, setListenerBusy] = useState(false);
  const [listenerMessage, setListenerMessage] = useState('');
  const [copyingAddress, setCopyingAddress] = useState(false);
  const [connectionSettings, setConnectionSettings] = useState(readConnectionSettings);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingStatus, setPingStatus] = useState<
    | { state: 'idle' }
    | { state: 'loading' | 'info'; message: string }
    | { state: 'success'; endpoint: string; adapter: string; fingerprint: string; latencyMs?: number }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [copyingReport, setCopyingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [updating, setUpdating] = useState<string>();
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!visible || listenerBusy || updating !== undefined) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const [currentInterfaces, currentListener, peers] = await Promise.all([
        readInterfaces(),
        readListenerStatus(),
        window.lanvory.trustedPeers().catch(() => null),
      ]);
      if (!active) return;
      setInterfaces(currentInterfaces);
      setListener(currentListener);
      const parsedPeers = z.array(z.object({ fingerprint: z.string(), verifiedAt: z.string() })).safeParse(peers);
      setTrustedPeers(parsedPeers.success ? parsedPeers.data : null);
      timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, visible, listenerBusy, updating]);


  const orderedAdapters = interfaces && [...interfaces].sort((a, b) => {
    const priority = (adapter: Interfaces[number]) => adapter.eligible ? (adapter.approved ? 1 : 0) : 2;
    return priority(a) - priority(b);
  });

  const bindOptions = (interfaces ?? []).flatMap((nic) => nic.eligible
    ? nic.addresses.map((cidr) => cidr.split('/')[0]).filter((address) => z.ipv4().safeParse(address).success)
      .map((address) => ({ value: `${nic.name}|${address}`, label: `${nic.name} · ${address}` }))
    : []);
  const approvedBinds = bindOptions.filter(({ value }) => interfaces?.some((nic) => nic.approved && nic.name === value.split('|')[0]));
  const defaultBind = approvedBinds.length === 1 ? approvedBinds[0].value
    : bindOptions.length === 1 ? bindOptions[0].value : undefined;
  const approvedAdapters = interfaces?.filter((nic) => nic.eligible && nic.approved);

  async function changeListener(action: 'start' | 'stop', adapter?: string, address?: string, settings?: ConnectionSettings) {
    setListenerBusy(true);
    setListenerMessage('');
    const approvalAdded = action === 'start' && adapter && !interfaces?.some((nic) => nic.name === adapter && nic.approved)
      ? adapter : undefined;
    if (approvalAdded) {
      const approved = await window.lanvory.setInterfaceApproval(approvalAdded, true).catch(() => false);
      if (!approved) {
        setListenerMessage('Could not approve the selected network. It may have changed.');
        setListenerBusy(false);
        return;
      }
    }
    const bind = address && settings ? `${address}:${settings.port}` : undefined;
    const result = listenerSchema.safeParse(await window.lanvory.setListener(action, adapter, bind, settings?.pairing).catch(() => null));
    const currentListener = result.success ? result.data : await readListenerStatus();
    setListener(currentListener);
    if (action === 'stop' && currentListener?.state === 'stopped') {
      const revoked = await window.lanvory.setInterfaceApproval(currentListener.adapter, false).catch(() => false);
      setInterfaces(await readInterfaces());
      if (!revoked) setListenerMessage('LAN is off, but the network permission could not be removed. Try Revoke in Advanced options.');
    } else if (action === 'start' && result.success && result.data.state === 'listening' && settings) {
      setConnectionSettings(settings);
      try {
        localStorage.setItem(connectionSettingsKey, JSON.stringify(settings));
      } catch {
        setListenerMessage('LAN is on, but the connection settings could not be saved.');
      }
    } else if (approvalAdded && currentListener && currentListener.state !== 'listening') {
      const revoked = await window.lanvory.setInterfaceApproval(approvalAdded, false).catch(() => false);
      setInterfaces(await readInterfaces());
      setListenerMessage(revoked ? 'Could not turn on LAN. The temporary network permission was removed.'
        : 'Could not turn on LAN or remove the temporary network permission. Try Revoke in Advanced options.');
    } else if (approvalAdded && !currentListener) {
      setListenerMessage('Could not confirm whether LAN is on. Check the network status before removing its permission.');
    } else {
      setListenerMessage(`Could not ${action === 'stop' ? 'turn off' : 'turn on'} LAN. Check its current status and try again.`);
    }
    setListenerBusy(false);
  }

  async function copyReport() {
    setCopyingReport(true);
    setReportMessage('');
    const copied = await window.lanvory.copyNetworkReport().catch(() => false);
    setReportMessage(copied ? 'Diagnostic report copied.' : 'Unable to copy the diagnostic report.');
    setCopyingReport(false);
  }

  async function copyAddress(endpoint: string) {
    setCopyingAddress(true);
    setListenerMessage('');
    const copied = await window.lanvory.copyLanAddress(endpoint).catch(() => false);
    setListenerMessage(copied ? 'LAN address copied.' : 'Unable to copy the current LAN address.');
    setCopyingAddress(false);
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const adapter = String(form.get('adapter') ?? '');
    const address = String(form.get('address') ?? '').trim();
    if (z.ipv4().safeParse(address).success === false) {
      setCheckResult('Enter a valid IPv4 address.');
      return;
    }
    setChecking(true);
    setCheckResult('');
    const result = scopeSchema.safeParse(await window.lanvory.checkScope(adapter, address).catch(() => null));
    if (!result.success) {
      setCheckResult('Unable to check the address. Try again.');
    } else if (result.data.allowed) {
      setCheckResult(`${address} on ${adapter}: allowed from ${result.data.source} on ${result.data.subnet}.`);
    } else {
      setCheckResult(`${address} on ${adapter}: ${deniedReasons[result.data.reason] ?? 'Address denied by the daemon.'}`);
    }
    setChecking(false);
  }

  async function pingPeer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const adapter = String(form.get('pingAdapter') ?? '').trim();
    const endpoint = String(form.get('pingEndpoint') ?? '').trim();
    const fingerprint = String(form.get('pingFingerprint') ?? '').trim();
    if (!adapter || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint) || !/^[a-fA-F0-9]{64}$/.test(fingerprint)) {
      setPingStatus({ state: 'error', message: 'Enter an approved adapter, IPv4:port endpoint, and 64-character device ID.' });
      return;
    }
    setPinging(true);
    setPingStatus({ state: 'loading', message: `Pinging ${endpoint} over ${adapter}…` });
    const result = await window.lanvory.pingPeer(adapter, endpoint, fingerprint).catch(() => ({ verified: false, latencyMs: undefined, error: 'Unable to reach peer.' }));
    if (result.verified) {
      onRoute?.({ fingerprint: fingerprint.toLowerCase(), adapter, endpoint });
      setPingStatus({
        state: 'success',
        endpoint,
        adapter,
        fingerprint: fingerprint.toLowerCase(),
        latencyMs: result.latencyMs,
      });
    } else {
      setPingStatus({ state: 'error', message: result.error ?? 'Peer unreachable or identity verification failed.' });
    }
    setPinging(false);
  }

  async function detectPeerEndpoint(fingerprint: string, endpointInput: HTMLInputElement | null) {
    const normalized = fingerprint.toLowerCase();
    const generation = ++detectGeneration.current;
    const saved = routes?.[normalized]?.endpoint;
    if (saved) {
      if (endpointInput) endpointInput.value = saved;
      setPingStatus({ state: 'info', message: `Detected saved endpoint ${saved}.` });
      return;
    }
    setPingStatus({ state: 'loading', message: 'Detecting peer endpoint via LAN discovery…' });
    const scan = scanSchema.safeParse(await window.lanvory.discover().catch(() => null));
    if (generation !== detectGeneration.current) return;
    if (!scan.success || scan.data.unavailable) {
      setPingStatus({ state: 'info', message: 'Unable to auto-detect endpoint on LAN. Enter the peer address manually.' });
      return;
    }
    for (const service of scan.data.services) {
      const resolved = resolutionSchema.safeParse(
        await window.lanvory.resolveDiscovery(service.interface, service.name).catch(() => null),
      );
      if (generation !== detectGeneration.current) return;
      if (!resolved.success) continue;
      for (const endpoint of resolved.data.endpoints.slice(0, 3)) {
        const matched = await window.lanvory.matchTrustedPeer(service.interface, endpoint).catch(() => null);
        if (generation !== detectGeneration.current) return;
        if (matched?.toLowerCase() === normalized) {
          if (endpointInput) endpointInput.value = endpoint;
          onRoute?.({ fingerprint: normalized, adapter: service.interface, endpoint });
          setPingStatus({ state: 'info', message: `Detected peer endpoint ${endpoint} on ${service.interface}.` });
          return;
        }
      }
    }
    if (generation === detectGeneration.current) {
      setPingStatus({ state: 'info', message: 'Could not auto-detect endpoint via mDNS. Enter the peer LAN address manually.' });
    }
  }

  async function update(adapter: string, approved: boolean) {
    setUpdating(adapter);
    setCheckResult('');
    const saved = await window.lanvory.setInterfaceApproval(adapter, approved).catch(() => false);
    setMessage(saved ? (approved ? `${adapter} approved.` : `${adapter} access revoked.`)
      : `Could not update ${adapter}. Check the adapter and try again.`);
    const [currentInterfaces, currentListener] = await Promise.all([readInterfaces(), readListenerStatus()]);
    setInterfaces(currentInterfaces);
    setListener(currentListener);
    setUpdating(undefined);
  }

  return (
    <section className="network-panel" aria-labelledby="network-heading">
      <h2 id="network-heading" className="sr-only">Network</h2>
      <section className="operation-card operation-highlight" aria-labelledby="listener-heading">
        <PanelHeading icon={Wifi} id="listener-heading" title="Local network"
          description="Turn on LAN access to find, pair with, and receive files from nearby devices." />
        {listener === undefined && <p>Reading listener status…</p>}
        {listener === null && <p>Listener status unavailable.</p>}
        {listener?.state === 'local-only' && <p className="state-pill">Local-only mode</p>}
        {listener?.state === 'stopped' && <p className="state-pill">LAN off</p>}
        {listener?.state === 'listening' && (
          <div className="network-active">
            <div className="network-status-row">
              <span className="state-pill is-active">LAN on</span>
              <span className="state-pill network-adapter-pill">Adapter <code>{listener.adapter}</code></span>
            </div>
            <div className="network-address">
              <p>Device address <code>{listener.endpoint}</code></p>
              <button type="button" className="refresh" aria-label="Copy LAN address" title="Copy LAN address"
                disabled={copyingAddress || listenerBusy} onClick={() => void copyAddress(listener.endpoint)}>
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
            <p>Incoming pairing {listener.pairing ? 'enabled' : 'disabled'}</p>
          </div>
        )}
        {listener?.state === 'listening' && (
          <button className="refresh" type="button" disabled={listenerBusy || updating !== undefined}
            onClick={() => void changeListener('stop')}>Turn off LAN</button>
        )}
        {listener && listener.state !== 'listening' && (
          bindOptions.length ? (
            <form className="trust-form" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const [adapter, address] = String(data.get('bind') ?? '').split('|');
              const settings = connectionSettingsSchema.safeParse({ port: Number(data.get('port')), pairing: data.has('pairing') });
              if (adapter && address && settings.success) void changeListener('start', adapter, address, settings.data);
            }}>
              <SelectField label="Network" name="bind" required placeholder="Select a network"
                defaultValue={defaultBind} disabled={listenerBusy} options={bindOptions} />
              <details className="trust-details"><summary>Connection settings</summary>
                <label>Port<input name="port" type="number" required min={0} max={65535} defaultValue={connectionSettings.port} disabled={listenerBusy} /></label>
                <label className="checkbox"><Checkbox name="pairing" defaultChecked={connectionSettings.pairing} disabled={listenerBusy} /> Accept incoming pairing requests</label>
              </details>
              <button type="submit" className="primary" disabled={listenerBusy || updating !== undefined}>Turn on LAN</button>
              <p>Nearby devices can connect through the network you select.</p>
            </form>
          ) : <p>Connect to an eligible IPv4 network to enable LAN.</p>
        )}
        {listenerBusy && <p role="status">Updating the LAN listener…</p>}
        {listenerMessage && <p role="status">{listenerMessage}</p>}
      </section>
      <NetworkExplorer
        deviceName={deviceName}
        listenerState={listener?.state ?? 'checking'}
        listenerEndpoint={listener?.state === 'listening' ? listener.endpoint : undefined}
        interfaces={interfaces}
        trustedPeers={trustedPeers}
        onPingPeer={(fingerprint) => {
          const scopeDetails = document.querySelector<HTMLDetailsElement>('[aria-labelledby=scope-heading]');
          if (scopeDetails) scopeDetails.open = true;
          const fpInput = document.querySelector<HTMLInputElement>('input[name="pingFingerprint"]');
          const endpointInput = document.querySelector<HTMLInputElement>('input[name="pingEndpoint"]');
          if (fpInput) fpInput.value = fingerprint;
          if (endpointInput) endpointInput.value = '';
          void detectPeerEndpoint(fingerprint, endpointInput);
          requestAnimationFrame(() => {
            const target = endpointInput ?? fpInput;
            const container = target?.closest<HTMLElement>('.page-scroll');
            if (target && container) {
              const containerRect = container.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();
              const top = container.scrollTop + (targetRect.top - containerRect.top) - (containerRect.height / 2) + (targetRect.height / 2);
              container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            }
            target?.focus({ preventScroll: true });
          });
        }}
      />
      <details className="operation-card operation-disclosure network-advanced">
        <summary>
          <SlidersHorizontal size={17} aria-hidden="true" />
          Advanced options
          <ChevronDown className="network-advanced-chevron" size={17} aria-hidden="true" />
        </summary>
        <section aria-labelledby="adapters-heading">
          <PanelHeading icon={Network} id="adapters-heading" title="Network adapters"
            action={<button type="button" className="refresh" disabled={interfaces === undefined || updating !== undefined || checking || listenerBusy} onClick={() => {
              setCheckResult('');
              setInterfaces(undefined);
              setRefresh((value) => value + 1);
            }}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>} />
          {message && <p role="status">{message}</p>}
          {interfaces === undefined && <p role="status">Reading interfaces…</p>}
          {interfaces === null && <p role="status">The daemon could not read local interfaces.</p>}
          {interfaces?.length === 0 && <p role="status">No network interfaces were reported.</p>}
          {interfaces && interfaces.length > 0 && (
            <ul className="interface-list adapter-list" tabIndex={0} aria-labelledby="adapters-heading">
              {orderedAdapters?.map((nic) => {
                const canApprove = nic.eligible && !nic.approved;
                const approved = nic.approved && nic.eligible;
                const status = nic.approved
                  ? approved ? 'Approved' : 'Approved · Inactive'
                  : canApprove ? 'Ready to approve' : nic.loopback ? 'Loopback' : nic.up ? 'Unavailable' : 'Offline';
                return (
                  <li key={nic.index} className="adapter-row" data-approvable={canApprove || undefined}>
                    <div className="adapter-identity">
                      <span className="panel-icon"><Network size={19} aria-hidden="true" /></span>
                      <div className="adapter-info">
                        <div className="adapter-name">
                          <strong>{nic.name}</strong>
                          <span className={approved ? 'state-pill is-active' : 'state-pill'}>{status}</span>
                        </div>
                        <p><code>{nic.addresses.find((address) => address.includes('.')) ?? 'No IPv4 address'}</code></p>
                      </div>
                    </div>
                    {(nic.approved || nic.eligible) && (
                      <button type="button" className={canApprove ? 'primary adapter-action' : 'refresh adapter-action'}
                        disabled={updating !== undefined || checking || listenerBusy}
                        aria-label={`${nic.approved ? 'Revoke' : 'Approve'} ${nic.name}`}
                        onClick={() => void update(nic.name, !nic.approved)}>
                        {canApprove && <ShieldCheck size={15} aria-hidden="true" />}
                        {updating === nic.name ? 'Saving…' : nic.approved ? 'Revoke' : 'Approve'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </details>
      <details className="operation-card operation-disclosure" aria-labelledby="scope-heading">
        <summary id="scope-heading"><SlidersHorizontal size={17} aria-hidden="true" /> Connection diagnostics</summary>
        <p>Copy local status and adapter counts for troubleshooting.</p>
        <button type="button" className="refresh" disabled={copyingReport} onClick={() => void copyReport()}>
          {copyingReport ? 'Copying…' : 'Copy diagnostic report'}
        </button>
        <p role="status">{reportMessage}</p>
        {!!interfaces?.length && <>
          <p>Check the daemon’s address policy without connecting to the destination.</p>
          <form className="trust-form" onSubmit={(event) => void check(event)}>
            <SelectField label="Adapter" name="adapter" required placeholder="Select an adapter"
              defaultValue={approvedAdapters?.length === 1 ? approvedAdapters[0].name : undefined}
              disabled={checking} options={interfaces.map((nic) => ({ value: nic.name, label: nic.name }))} />
            <label>Destination IPv4 address<input name="address" required maxLength={15} placeholder="192.168.1.42" disabled={checking} /></label>
            <button type="submit" className="refresh" disabled={checking || updating !== undefined}>{checking ? 'Checking…' : 'Check address'}</button>
          </form>
          <p className="scope-result" role="status">{checkResult}</p>
          <div className="network-ping-section">
            <h4>Authenticated peer ping</h4>
            <p>Measure round-trip latency and verify a peer’s Ed25519 identity without exchanging data.</p>
            <form className="trust-form network-ping-form" onSubmit={(event) => void pingPeer(event)}>
              <SelectField label="Adapter" name="pingAdapter" required placeholder="Select an approved adapter"
                defaultValue={approvedAdapters?.length === 1 ? approvedAdapters[0].name : undefined}
                disabled={pinging || !approvedAdapters?.length}
                options={(approvedAdapters ?? []).map((nic) => ({ value: nic.name, label: nic.name }))} />
              <label>Peer endpoint<input name="pingEndpoint" required maxLength={21} placeholder="192.168.1.42:43110" disabled={pinging} /></label>
              <label>Peer device ID<input name="pingFingerprint" required maxLength={64} placeholder="64-character hex fingerprint" disabled={pinging}
                onChange={(event) => {
                  const fp = event.currentTarget.value.trim().toLowerCase();
                  if (/^[a-f0-9]{64}$/.test(fp)) {
                    const endpointInput = event.currentTarget.form?.elements.namedItem('pingEndpoint') as HTMLInputElement | null;
                    if (endpointInput && !endpointInput.value.trim()) {
                      void detectPeerEndpoint(fp, endpointInput);
                    }
                  }
                }} /></label>
              <button type="submit" className="refresh" disabled={pinging || updating !== undefined || !approvedAdapters?.length}>
                {pinging ? 'Pinging…' : 'Ping peer'}
              </button>
            </form>
            {pingStatus.state === 'success' && (
              <div className="ping-result-card is-success" role="status">
                <div className="ping-result-icon">
                  <ShieldCheck size={18} aria-hidden="true" />
                </div>
                <div className="ping-result-body">
                  <div className="ping-result-header">
                    <strong>Peer authenticated &amp; reachable</strong>
                    <span className="ping-latency-pill">
                      <Activity size={12} aria-hidden="true" />
                      {pingStatus.latencyMs ?? 0} ms RTT
                    </span>
                  </div>
                  <div className="ping-result-meta">
                    <span>Endpoint <code>{pingStatus.endpoint}</code></span>
                    <span>Adapter <code>{pingStatus.adapter}</code></span>
                    <span>ID <code>{pingStatus.fingerprint.slice(0, 8)}…{pingStatus.fingerprint.slice(-6)}</code></span>
                  </div>
                </div>
              </div>
            )}
            {pingStatus.state === 'error' && (
              <div className="ping-result-card is-error" role="status">
                <div className="ping-result-icon">
                  <AlertCircle size={18} aria-hidden="true" />
                </div>
                <div className="ping-result-body">
                  <strong>Ping failed</strong>
                  <p>{pingStatus.message}</p>
                </div>
              </div>
            )}
            {(pingStatus.state === 'loading' || pingStatus.state === 'info') && (
              <div className="ping-result-card is-info" role="status">
                <div className="ping-result-icon">
                  {pingStatus.state === 'loading'
                    ? <Loader2 size={17} className="spinning" aria-hidden="true" />
                    : <Info size={17} aria-hidden="true" />}
                </div>
                <div className="ping-result-body">
                  <p>{pingStatus.message}</p>
                </div>
              </div>
            )}
          </div>
        </>}
      </details>
    </section>
  );
}

import { useState } from 'react';
import { Activity, Boxes, Monitor, Radar, Search, Send, ShieldCheck } from 'lucide-react';
import { MyDevice } from '../features/devices/my-device';
import { NearbyServices, type PairingTarget } from '../features/devices/nearby';
import { PairingPanel } from '../features/devices/pairing';
import { TrustedPeers } from '../features/devices/trusted-peers';
import type { PeerRoute } from '../features/sharing/sharing';
import type { IdentityResponse } from '../services/identity';

export function DevicesPage({ response, retrying, visible, incomingPairingEnabled, scanRevision, nearbyCount, counts, trustRevision, pairingTarget,
  onDiscover, onShare, onServices, onNetwork, onRetry, onCount: setNearbyCount, onSelectPeer, onClearTarget, onPaired, onTrustChange }: {
  response?: IdentityResponse;
  retrying: boolean;
  visible: boolean;
  incomingPairingEnabled: boolean;
  scanRevision: number;
  nearbyCount?: number;
  counts: { trusted?: number; services?: number; transfers?: number };
  trustRevision: number;
  pairingTarget: { revision: number; target?: PairingTarget };
  onDiscover(): void;
  onShare(): void;
  onServices(): void;
  onNetwork(): void;
  onRetry(): void;
  onCount(count?: number): void;
  onSelectPeer(target: PairingTarget): void;
  onClearTarget(): void;
  onPaired(peer: PeerRoute): void;
  onTrustChange(): void;
}) {
  const identity = response?.device;
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'nearby' | 'trusted'>('all');

  function openManualPairing() {
    onClearTarget();
    document.getElementById('pairing-heading')?.focus();
  }

  return (
    <div className="dashboard"><div className="workspace">
          <section className="hero" aria-labelledby="hero">
            <MyDevice incomingPairingEnabled={incomingPairingEnabled} response={response} retrying={retrying} onRetry={onRetry} />
            <div className="orbit" aria-hidden="true"><i /><i /><i /></div>
            <h1 id="hero">Your<br />devices,<br />connected<br /><em>locally.</em></h1>
            <div className="principles">
              <button type="button" onClick={onDiscover} disabled={!identity}><Radar size={17} aria-hidden="true" /> Find devices</button>
              <button type="button" onClick={onShare}><Send size={17} aria-hidden="true" /> Send a file</button>
            </div>
            <p className="local-note"><ShieldCheck size={15} aria-hidden="true" /> Your files stay on your local network.</p>
          </section>
          <section className="devices device-directory" aria-labelledby="devices" hidden={filter === 'trusted'}>
            <h2 id="devices" className="sr-only">Devices</h2>
            <NearbyServices key={identity?.id} scanRevision={scanRevision} searchQuery={searchQuery} onCount={setNearbyCount} onNetwork={onNetwork}
              ready={Boolean(identity)} trustRevision={trustRevision} onVerified={onPaired} onPair={onSelectPeer} onManualPair={openManualPairing} />
          </section>
        </div>
        <div className="dashboard-metrics" aria-label="LAN overview">
          {([
            { icon: Monitor, count: nearbyCount, label: 'Nearby devices', action: () => { setFilter('all'); onDiscover(); }, ariaLabel: 'View and scan nearby devices' },
            { icon: ShieldCheck, count: counts.trusted, label: 'Trusted devices', action: () => {
              setFilter('all');
              const el = document.getElementById('trusted-heading');
              el?.scrollIntoView({ behavior: 'smooth' });
              el?.focus();
            }, ariaLabel: 'View paired devices' },
            { icon: Boxes, count: counts.services, label: 'Shared services', action: onServices, ariaLabel: 'Manage shared services' },
            { icon: Activity, count: counts.transfers, label: 'Active transfers', action: onShare, ariaLabel: 'View active transfers in Sharing' },
          ] as const).map(({ icon: Icon, count, label, action, ariaLabel }) => (
            <button
              type="button"
              className="metric"
              key={label}
              onClick={action}
              aria-label={ariaLabel}
            >
              <Icon size={25} aria-hidden="true" />
              <strong>{count ?? '—'}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
        {identity && <div className="devices-toolbar" role="search" aria-label="Filter devices">
          <label className="devices-search-field">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search nearby or paired devices…" aria-label="Search devices" />
          </label>
          <div className="devices-filter-group" role="group" aria-label="Device category filter">
            {([
              ['all', 'All'],
              ['nearby', 'Nearby'],
              ['trusted', 'Trusted'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? 'devices-filter-btn is-active' : 'devices-filter-btn'}
                aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>}
        {identity && <div className="dashboard-details">
              <PairingPanel onNetwork={onNetwork} selection={pairingTarget} onClearTarget={onClearTarget} visible={visible} onPaired={onPaired} onChange={onTrustChange} />
              {filter !== 'nearby' && <TrustedPeers key={identity.id} ownerId={identity.id} externalRevision={trustRevision} visible={visible} searchQuery={searchQuery} />}
        </div>}
        </div>
  );
}

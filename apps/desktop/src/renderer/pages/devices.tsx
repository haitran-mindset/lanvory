import { useState } from 'react';
import { Monitor, Radar, Send, ShieldCheck, Wifi } from 'lucide-react';
import { MyDevice } from '../features/devices/my-device';
import { NearbyServices, type PairingTarget } from '../features/devices/nearby';
import { PairingPanel } from '../features/devices/pairing';
import { TrustedPeers } from '../features/devices/trusted-peers';
import type { PeerRoute } from '../features/sharing/sharing';
import type { IdentityResponse } from '../services/identity';

export function DevicesPage({ response, retrying, visible, incomingPairingEnabled, scanRevision, nearbyCount, counts, trustRevision, pairingTarget, routes,
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
  routes?: Record<string, PeerRoute>;
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
  const [filter, setFilter] = useState<'all' | 'nearby' | 'trusted'>('all');

  function openManualPairing() {
    onClearTarget();
    document.getElementById('pairing-heading')?.focus();
  }

  return (
    <div className="dashboard devices-dashboard">
      <div className="devices-workspace-grid">
        <div className="devices-left-column">
          <MyDevice incomingPairingEnabled={incomingPairingEnabled} response={response} retrying={retrying} onRetry={onRetry} />

          <section className="devices-hero-stage" aria-labelledby="hero">
            <div className="devices-hero-orb" aria-hidden="true">
              <div className="hero-orb-glow" />
              <div className="hero-orb-sphere">
                <svg viewBox="0 0 240 240" className="hero-orb-svg" fill="none">
                  <defs>
                    <radialGradient id="orbCoreGrad" cx="38%" cy="32%" r="68%">
                      <stop offset="0%" stopColor="#34d399" stopOpacity="0.34" />
                      <stop offset="48%" stopColor="#0f3d2b" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#040d09" stopOpacity="0.92" />
                    </radialGradient>
                    <linearGradient id="orbRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#4ade80" stopOpacity="0.9" />
                      <stop offset="50%" stopColor="#10b981" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#34d399" stopOpacity="0.8" />
                    </linearGradient>
                  </defs>
                  <circle cx="120" cy="120" r="78" fill="url(#orbCoreGrad)" stroke="#34d399" strokeOpacity="0.28" strokeWidth="1.2" />
                  <g className="hero-orb-grid">
                    <ellipse cx="120" cy="120" rx="78" ry="26" stroke="#34d399" strokeOpacity="0.26" strokeWidth="1" />
                    <ellipse cx="120" cy="120" rx="78" ry="54" stroke="#34d399" strokeOpacity="0.18" strokeWidth="1" />
                    <ellipse cx="120" cy="120" rx="28" ry="78" stroke="#34d399" strokeOpacity="0.28" strokeWidth="1" />
                    <ellipse cx="120" cy="120" rx="56" ry="78" stroke="#34d399" strokeOpacity="0.2" strokeWidth="1" />
                    <line x1="42" y1="120" x2="198" y2="120" stroke="#34d399" strokeOpacity="0.2" strokeWidth="1" />
                    <line x1="120" y1="42" x2="120" y2="198" stroke="#34d399" strokeOpacity="0.2" strokeWidth="1" />
                  </g>
                  <g className="hero-orb-ring-outer">
                    <ellipse cx="120" cy="120" rx="104" ry="38" transform="rotate(-24 120 120)" stroke="url(#orbRingGrad)" strokeWidth="1.5" strokeDasharray="6 5" />
                    <circle cx="212" cy="79" r="4.2" fill="#4ade80" />
                    <circle cx="28" cy="161" r="3.2" fill="#34d399" fillOpacity="0.85" />
                  </g>
                  <g className="hero-orb-ring-inner">
                    <ellipse cx="120" cy="120" rx="96" ry="32" transform="rotate(28 120 120)" stroke="url(#orbRingGrad)" strokeWidth="1.3" />
                    <circle cx="204" cy="165" r="3.6" fill="#6ee7b7" />
                  </g>
                  <circle cx="120" cy="120" r="14" fill="#34d399" fillOpacity="0.18" className="hero-orb-pulse" />
                  <circle cx="120" cy="120" r="5.5" fill="#4ade80" />
                </svg>
              </div>
            </div>
            <div className="devices-hero-stage-content">
              <h1 id="hero">Your<br />devices,<br />connected<br /><em>locally.</em></h1>
              <p className="devices-hero-sub">Find, share and sync between your devices on the same local network — no cloud, no limits.</p>
              <div className="devices-hero-actions">
                <button type="button" className="primary" onClick={onDiscover} disabled={!identity}>
                  <Radar size={16} aria-hidden="true" />
                  <span>Find devices</span>
                </button>
                <button type="button" className="refresh" onClick={onShare}>
                  <Send size={16} aria-hidden="true" />
                  <span>Send a file</span>
                </button>
              </div>
            </div>
          </section>

          <div className="dashboard-metrics devices-left-metrics" aria-label="Devices overview">
            {([
              { icon: Monitor, count: nearbyCount, label: 'Nearby devices', sub: 'Discovered in scan', action: () => { setFilter('all'); onDiscover(); }, ariaLabel: 'View and scan nearby devices' },
              { icon: ShieldCheck, count: counts.trusted, label: 'Trusted devices', sub: 'Paired & verified', action: () => {
                setFilter('all');
                const el = document.getElementById('trusted-heading');
                el?.scrollIntoView({ behavior: 'smooth' });
                el?.focus();
              }, ariaLabel: 'View paired devices' },
            ] as const).map(({ icon: Icon, count, label, sub, action, ariaLabel }) => (
              <button
                type="button"
                className="metric devices-metric-card"
                key={label}
                onClick={action}
                aria-label={ariaLabel}
              >
                <span className="devices-metric-icon"><Icon size={19} aria-hidden="true" /></span>
                <span className="devices-metric-copy">
                  <span className="devices-metric-label">{label}</span>
                  <small>{sub}</small>
                </span>
                <strong className="devices-metric-value">{count ?? '—'}</strong>
              </button>
            ))}
          </div>
        </div>

        <section className="devices device-directory" aria-labelledby="devices" hidden={filter === 'trusted'}>
          <h2 id="devices" className="sr-only">Devices</h2>
          <NearbyServices key={identity?.id} scanRevision={scanRevision} onCount={setNearbyCount} onNetwork={onNetwork}
            ready={Boolean(identity)} trustRevision={trustRevision} onVerified={onPaired} onPair={onSelectPeer} onManualPair={openManualPairing} />
        </section>
      </div>

      <div className="devices-highlights-strip" aria-label="Local connection highlights">
        <div className="devices-highlight-item">
          <span className="devices-highlight-icon"><Wifi size={18} aria-hidden="true" /></span>
          <div>
            <strong>Same Wi-Fi or LAN</strong>
            <small>Both devices must be on the same local network subnet.</small>
          </div>
        </div>
        <div className="devices-highlight-item">
          <span className="devices-highlight-icon"><Monitor size={18} aria-hidden="true" /></span>
          <div>
            <strong>Keep Lanvory open</strong>
            <small>Ensure Lanvory is active on your other device to be found.</small>
          </div>
        </div>
        <div className="devices-highlight-item">
          <span className="devices-highlight-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
          <div>
            <strong>Direct &amp; Private</strong>
            <small>100% peer-to-peer. Zero cloud servers or accounts needed.</small>
          </div>
        </div>
      </div>

      {identity && (
        <div className="devices-bottom-grid">
          <PairingPanel onNetwork={onNetwork} selection={pairingTarget} onClearTarget={onClearTarget} visible={visible} onPaired={onPaired} onChange={onTrustChange} />
          <TrustedPeers key={identity.id} ownerId={identity.id} externalRevision={trustRevision} visible={visible} routes={routes} />
        </div>
      )}
    </div>
  );
}

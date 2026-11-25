import { useState } from 'react';
import { Activity, Monitor, Network, ShieldCheck, Wifi } from 'lucide-react';
import type { Interfaces } from '../../services/network-interfaces';

type ExplorerNode =
  | { id: string; kind: 'local'; label: string; detail: string; badge: string }
  | { id: string; kind: 'adapter'; label: string; detail: string; badge: string }
  | { id: string; kind: 'peer'; label: string; detail: string; badge: string };

export function NetworkExplorer({
  deviceName,
  listenerState,
  listenerEndpoint,
  interfaces,
  trustedPeers,
  onPingPeer,
}: {
  deviceName?: string;
  listenerState: string;
  listenerEndpoint?: string;
  interfaces: Interfaces | null | undefined;
  trustedPeers: Array<{ fingerprint: string; verifiedAt: string }> | null | undefined;
  onPingPeer?(fingerprint: string): void;
}) {
  const [selected, setSelected] = useState<ExplorerNode | null>(null);
  const approved = (interfaces ?? []).filter((nic) => nic.approved);
  const peers = trustedPeers ?? [];
  const listening = listenerState === 'listening';

  return (
    <section className="operation-card network-explorer-card" aria-labelledby="explorer-heading">
      <div className="panel-heading">
        <span className="panel-icon">
          <Network size={20} aria-hidden="true" />
        </span>
        <div>
          <h3 id="explorer-heading">Network explorer</h3>
          <p>Factual local topology known to this device — no inferred remote hops or simulated links.</p>
        </div>
      </div>

      <div className="explorer-graph" role="region" aria-label="Local network topology">
        {/* Column 1: Approved Adapters */}
        <div className="explorer-column">
          <div className="explorer-col-header">
            <span className="explorer-col-label">Approved Adapters</span>
            <span className="explorer-col-count">{approved.length}</span>
          </div>
          <div className="explorer-col-body">
            {approved.length === 0 ? (
              <div className="explorer-empty">
                <Wifi size={15} aria-hidden="true" />
                <span>No approved LAN adapters</span>
              </div>
            ) : (
              approved.map((nic) => {
                const ipv4 = nic.addresses.find((addr) => addr.includes('.')) ?? 'No IPv4 address';
                const nodeId = `adapter:${nic.name}`;
                return (
                  <button
                    key={nic.index}
                    type="button"
                    className={`explorer-node is-adapter${selected?.id === nodeId ? ' is-selected' : ''}`}
                    onClick={() =>
                      setSelected({
                        id: nodeId,
                        kind: 'adapter',
                        label: nic.name,
                        detail: nic.addresses.join(', ') || 'No IPv4 address',
                        badge: nic.eligible ? 'Active' : 'Inactive',
                      })
                    }
                  >
                    <span className="explorer-node-icon">
                      <Wifi size={15} aria-hidden="true" />
                    </span>
                    <div className="explorer-node-text">
                      <strong>{nic.name}</strong>
                      <small>{ipv4}</small>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Connector 1 */}
        <div className="explorer-connector" aria-hidden="true">
          <span className={approved.length > 0 ? 'explorer-line is-live' : 'explorer-line'} />
          <span className={approved.length > 0 ? 'explorer-link-pill is-live' : 'explorer-link-pill'}>LAN</span>
          <span className={approved.length > 0 ? 'explorer-line is-live' : 'explorer-line'} />
        </div>

        {/* Column 2: This Node */}
        <div className="explorer-column">
          <div className="explorer-col-header">
            <span className="explorer-col-label">This Node</span>
            <span className={listening ? 'state-pill is-active explorer-status-mini' : 'state-pill explorer-status-mini'}>
              {listening ? 'Active' : 'Local-only'}
            </span>
          </div>
          <div className="explorer-col-body">
            <button
              type="button"
              className={`explorer-node is-local${listening ? ' is-live' : ''}${selected?.id === 'local' ? ' is-selected' : ''}`}
              onClick={() =>
                setSelected({
                  id: 'local',
                  kind: 'local',
                  label: deviceName ?? 'Lanvory Device',
                  detail: listening && listenerEndpoint ? `Listening on ${listenerEndpoint}` : `Mode: ${listenerState}`,
                  badge: listening ? 'LAN active' : listenerState,
                })
              }
            >
              <span className="explorer-node-icon is-local">
                <Monitor size={17} aria-hidden="true" />
              </span>
              <div className="explorer-node-text">
                <strong>{deviceName ?? 'This device'}</strong>
                <small>{listening && listenerEndpoint ? listenerEndpoint : listenerState}</small>
              </div>
            </button>
          </div>
        </div>

        {/* Connector 2 */}
        <div className="explorer-connector" aria-hidden="true">
          <span className={peers.length > 0 && listening ? 'explorer-line is-live' : 'explorer-line'} />
          <span className={peers.length > 0 && listening ? 'explorer-link-pill is-live' : 'explorer-link-pill'}>mTLS</span>
          <span className={peers.length > 0 && listening ? 'explorer-line is-live' : 'explorer-line'} />
        </div>

        {/* Column 3: Trusted Peers */}
        <div className="explorer-column">
          <div className="explorer-col-header">
            <span className="explorer-col-label">Trusted Peers</span>
            <span className="explorer-col-count">{peers.length}</span>
          </div>
          <div className="explorer-col-body">
            {peers.length === 0 ? (
              <div className="explorer-empty">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>No paired peers yet</span>
              </div>
            ) : (
              peers.map((peer) => {
                const shortId = `${peer.fingerprint.slice(0, 8)}…${peer.fingerprint.slice(-6)}`;
                const nodeId = `peer:${peer.fingerprint}`;
                return (
                  <button
                    key={peer.fingerprint}
                    type="button"
                    className={`explorer-node is-peer${selected?.id === nodeId ? ' is-selected' : ''}`}
                    onClick={() =>
                      setSelected({
                        id: nodeId,
                        kind: 'peer',
                        label: shortId,
                        detail: `Verified on ${new Date(peer.verifiedAt).toLocaleDateString()}`,
                        badge: 'Trusted',
                      })
                    }
                  >
                    <span className="explorer-node-icon">
                      <ShieldCheck size={15} aria-hidden="true" />
                    </span>
                    <div className="explorer-node-text">
                      <strong>{shortId}</strong>
                      <small>Trusted peer</small>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className="explorer-inspector" role="status">
          <Activity size={15} aria-hidden="true" className="explorer-inspector-icon" />
          <strong>{selected.label}</strong>
          <span className="state-pill is-active">{selected.badge}</span>
          <span className="explorer-inspector-detail">{selected.detail}</span>
          {selected.kind === 'peer' && onPingPeer && (
            <button
              type="button"
              className="refresh explorer-inspector-action"
              onClick={() => onPingPeer(selected.id.replace(/^peer:/, ''))}
            >
              Ping peer
            </button>
          )}
        </div>
      )}
    </section>
  );
}

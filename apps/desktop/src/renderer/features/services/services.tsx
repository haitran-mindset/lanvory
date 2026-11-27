import { WorkspaceTabs, WorkspaceTabPanel } from '../../components/workspace-tabs';
import { type FormEvent, useEffect, useState } from "react";
import { SelectField, accessDurations } from "../../components/ui/select";
import { z } from "zod";
import {
  ArrowDownLeft,
  ExternalLink,
  Laptop,
  Lock,
  Plug,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { PeerRoute } from "../sharing/sharing";
import { pairedDeviceName, readPairedNames } from "../../services/paired-names";
import { readDefaultDuration } from "../../services/permission-defaults";
import { PanelHeading } from "../../components/panel-heading";
import { useNotifications } from "../../components/notifications";
import {
  connectionError,
  isP2PRoute,
  lanSuggestedEndpoint,
  PeerConnectionFields,
} from "../../components/peer-connection-fields";

const snapshotSchema = z.object({
  services: z.array(z.object({ id: z.string(), target: z.string() })),
  tunnels: z.array(
    z.object({
      id: z.string(),
      service: z.string(),
      bind: z.string(),
      connections: z.number().nonnegative(),
      lastError: z.string().optional(),
    }),
  ),
  grants: z.array(
    z.object({
      fingerprint: z.string(),
      capability: z.string(),
      resource: z.string(),
      expiresAt: z.iso.datetime().optional(),
      inactive: z.boolean().optional(),
    }),
  ),
  peers: z.array(z.object({ fingerprint: z.string() })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

export function Services({
  ownerId,
  visible,
  routes,
  onPair,
  onRoute,
}: {
  ownerId?: string;
  visible: boolean;
  routes: Record<string, PeerRoute>;
  onPair(): void;
  onRoute?(route: PeerRoute): void;
}) {
  const { notify } = useNotifications();
  const [names] = useState(() => (ownerId ? readPairedNames(ownerId) : {}));
  const [snapshot, setSnapshot] = useState<Snapshot | null>();
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'share' | 'connect'>('share');
  const [message, setMessage] = useState("");
  const [connectionReady, setConnectionReady] = useState(false);
  const [forceLanAddress, setForceLanAddress] = useState(false);
  const [discoveredServices, setDiscoveredServices] = useState<string[]>([]);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [serviceNameInput, setServiceNameInput] = useState("");
  const [lastServiceConn, setLastServiceConn] = useState<{ adapter: string; endpoint: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const result = snapshotSchema.safeParse(
        await window.lanvory.serviceSnapshot().catch(() => null),
      );
      if (!active) return;
      setSnapshot(result.success ? result.data : null);
      if (result.success && result.data.peers.length === 1) {
        const onlyPeer = result.data.peers[0].fingerprint;
        setRecipient((current) => current || onlyPeer);
      }
      timer = setTimeout(load, 2000);
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [revision, visible]);

  async function update(action: string, fields: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      if (
        action === "open" &&
        !isP2PRoute({ adapter: fields.adapter, endpoint: fields.endpoint })
      ) {
        const error = await connectionError(fields.adapter, fields.endpoint);
        if (error) {
          setMessage(error);
          return;
        }
      }
      const result = await window.lanvory.serviceAction(action, fields);
      if (result.ok) {
        setMessage("");
        notify({
          category: "services",
          tone: "success",
          title: "Service settings updated.",
        });
      } else {
        setMessage(result.error || "Action failed. Check the address, current peer trust and adapter approval.");
      }
      if (result.ok) {
        if (
          action === "open" &&
          fields.fingerprint &&
          fields.adapter &&
          fields.endpoint
        ) {
          onRoute?.({
            fingerprint: fields.fingerprint,
            adapter: fields.adapter,
            endpoint: fields.endpoint,
          });
        }
        setRevision((value) => value + 1);
      }
    } catch {
      setMessage("Unable to reach the daemon.");
    } finally {
      setBusy(false);
    }
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
    action: string,
    additional: Record<string, string> = {},
  ) {
    event.preventDefault();
    const fields: Record<string, string> = {};
    new FormData(event.currentTarget).forEach((value, key) => {
      fields[key] = String(value).trim();
    });
    if (action === "open" && fields.fingerprint !== selectedDevice) return;
    void update(action, { ...fields, ...additional });
  }

  const peerOptions = (snapshot?.peers ?? []).map(({ fingerprint }) => ({
    value: fingerprint,
    label: pairedDeviceName(fingerprint, names),
  }));
  const selectedDevice = peerOptions.some(({ value }) => value === recipient)
    ? recipient
    : "";
  const route = routes[selectedDevice];
  const usingP2PRoute = !forceLanAddress && isP2PRoute(route);
  return (
    <section
      className="network-panel services-panel tabbed-workspace"
      aria-labelledby="services-heading"
    >
      <h2 id="services-heading" className="sr-only">
        Services
      </h2>
      {snapshot === undefined && <p>Loading services…</p>}
      {snapshot === null && (
        <p role="status">Unable to load services. Reconnecting…</p>
      )}
      <WorkspaceTabs name="services" label="Services sections" active={tab} onChange={setTab} tabs={[{ id: 'share', label: 'Share locally', icon: Server }, { id: 'connect', label: 'Connect remotely', icon: ArrowDownLeft }]} />
      <WorkspaceTabPanel name="services" id="share" active={tab}>
        <section className="operation-card operation-highlight">
          <PanelHeading
            icon={Server}
            title="Share from this device"
            description="Add an app running here, then grant access to a paired device."
          />
          <form
            className="trust-form"
            onSubmit={(event) => submit(event, "share")}
          >
            <label>
              Name to share
              <input
                name="id"
                placeholder="my-app"
                required
                maxLength={64}
                pattern="[a-z0-9][a-z0-9_\-]{0,63}"
              />
            </label>
            <label>
              App address on this device
              <input name="target" required placeholder="127.0.0.1:8080" />
            </label>
            <button
              className="primary"
              type="submit"
              disabled={busy || !snapshot}
            >
              Share service
            </button>
          </form>
          {snapshot?.services.length === 0 && (
            <p className="panel-empty">You haven’t shared a service yet.</p>
          )}
          {!!snapshot?.services.length && (
            <div className="services-section-divider">
              <span className="services-section-title">
                Your shared services
              </span>
              <span className="tag">{snapshot.services.length}</span>
            </div>
          )}
          {snapshot?.services.map((service) => {
            const serviceGrants = snapshot.grants.filter(
              (grant) =>
                grant.capability === "service-connect" &&
                grant.resource === service.id,
            );
            return (
              <div className="sharing-item service-card" key={service.id}>
                <div className="service-card-header">
                  <div className="service-card-identity">
                    <div className="service-icon-box">
                      <Server size={18} aria-hidden="true" />
                    </div>
                    <div className="service-meta">
                      <div className="service-title-row">
                        <strong className="service-name">{service.id}</strong>
                        <span className="service-target-badge">
                          <span
                            className="service-status-dot"
                            aria-hidden="true"
                          />
                          {service.target}
                        </span>
                      </div>
                      <div
                        className={`service-access-hint${serviceGrants.length > 0 ? " active" : ""}`}
                      >
                        {serviceGrants.length === 0 ? (
                          <>
                            <Lock size={12} aria-hidden="true" />
                            <span>Private · No devices have access</span>
                          </>
                        ) : (
                          <>
                            <Users size={12} aria-hidden="true" />
                            <span>
                              Shared with {serviceGrants.length} paired device
                              {serviceGrants.length === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="refresh service-action-icon-btn service-delete-btn"
                    title="Remove service"
                    aria-label="Remove service"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${service.id} and revoke all of its grants?`,
                        )
                      )
                        void update("remove", { id: service.id });
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    <span className="sr-only">Remove service</span>
                  </button>
                </div>

                {serviceGrants.length > 0 ? (
                  <div className="service-grants-list">
                    <div className="service-sub-label">
                      Devices with access ({serviceGrants.length})
                    </div>
                    {serviceGrants.map((grant) => (
                      <div
                        className="service-grant-row"
                        key={grant.fingerprint}
                      >
                        <div className="service-grant-info">
                          <Laptop
                            size={14}
                            className="service-device-icon"
                            aria-hidden="true"
                          />
                          <strong className="service-grant-name">
                            {pairedDeviceName(grant.fingerprint, names)}
                          </strong>
                          {grant.inactive && (
                            <span className="service-grant-badge">
                              Needs renewal
                            </span>
                          )}
                          {grant.expiresAt ? (
                            <span className="service-grant-meta">
                              Expires{" "}
                              {new Date(grant.expiresAt).toLocaleString(
                                undefined,
                                { dateStyle: "short", timeStyle: "short" },
                              )}
                            </span>
                          ) : (
                            <span className="service-grant-meta">
                              Until revoked
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="refresh service-action-icon-btn service-revoke-btn"
                          title="Revoke access"
                          aria-label="Revoke access"
                          disabled={busy}
                          onClick={() =>
                            void update("revoke", {
                              id: service.id,
                              fingerprint: grant.fingerprint,
                            })
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span className="sr-only">Revoke access</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="service-empty-grants">
                    <Lock size={13} aria-hidden="true" />
                    <span>
                      Only accessible on this device. Grant access below to
                      allow paired peers to connect.
                    </span>
                  </div>
                )}

                {snapshot.peers.length === 0 ? (
                  <p className="service-no-peers">
                    Pair a device to grant access to this service.
                  </p>
                ) : (
                  <form
                    className="trust-form service-grant-form"
                    onSubmit={(event) =>
                      submit(event, "grant", { id: service.id })
                    }
                  >
                    <div className="service-grant-form-header">
                      <ShieldCheck size={14} aria-hidden="true" />
                      <span>Grant access to a paired device</span>
                    </div>
                    <div className="service-grant-fields">
                      <SelectField
                        label="Paired device"
                        name="fingerprint"
                        required
                        defaultValue={peerOptions.length === 1 ? peerOptions[0].value : undefined}
                        placeholder="Select a device"
                        options={peerOptions}
                      />
                      <SelectField
                        label="Access duration"
                        name="duration"
                        defaultValue={readDefaultDuration()}
                        options={accessDurations}
                      />
                    </div>
                    <button
                      className="primary service-grant-btn"
                      type="submit"
                      disabled={busy}
                    >
                      Grant access
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </section>
      </WorkspaceTabPanel>
      <WorkspaceTabPanel name="services" id="connect" active={tab}>
        <section className="operation-card">
          <PanelHeading
            icon={ArrowDownLeft}
            title="Connect to another device’s service"
            description="Use the service name and Lanvory address from the device sharing the app."
          />
          {snapshot?.peers.length === 0 && (
            <div className="pair-required services-pair">
              <p>Pair with the device that’s sharing the app.</p>
              <button type="button" className="refresh" onClick={onPair}>
                Pair a device
              </button>
            </div>
          )}
          {!!peerOptions.length && (
            <form
              className="trust-form services-connect-form"
              onSubmit={(event) => submit(event, "open")}
            >
              <SelectField
                label="Device sharing the service"
                name="fingerprint"
                required
                placeholder="Select the sharing device"
                options={peerOptions}
                value={selectedDevice}
                onValueChange={(value) => {
                  setRecipient(value);
                  setForceLanAddress(false);
                  setDiscoveredServices([]);
                  setServiceNameInput("");
                  setLastServiceConn(null);
                }}
                disabled={busy}
              />
              {selectedDevice && (
                <div key={selectedDevice} className="services-device-fields">
                  {usingP2PRoute && (
                    <>
                      <input
                        type="hidden"
                        name="adapter"
                        value={route!.adapter}
                      />
                      <input
                        type="hidden"
                        name="endpoint"
                        value={route!.endpoint}
                      />
                      <div className="paired-device-meta-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <span className="paired-method-badge is-p2p">
                          Bluetooth + Wi-Fi P2P
                        </span>
                        <button
                          type="button"
                          className="refresh"
                          style={{ minHeight: 28, padding: "0 10px", fontSize: ".76rem" }}
                          onClick={() => setForceLanAddress(true)}
                        >
                          Use LAN address instead
                        </button>
                      </div>
                    </>
                  )}
                  {!usingP2PRoute && (
                    <PeerConnectionFields
                      suggestedEndpoint={lanSuggestedEndpoint(route)}
                      endpointLabel="Lanvory address of the sharing device"
                      adapterLabel="Network adapter on this device"
                      disabled={busy}
                      onReady={setConnectionReady}
                    />
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      className="refresh"
                      disabled={busy || discoverBusy || (!usingP2PRoute && !connectionReady)}
                      onClick={(e) => {
                        const form = e.currentTarget.form;
                        if (!form) return;
                        const fd = new FormData(form);
                        const adapter = usingP2PRoute ? route!.adapter : String(fd.get("adapter") ?? "").trim();
                        const endpoint = usingP2PRoute ? route!.endpoint : String(fd.get("endpoint") ?? "").trim();
                        setDiscoverBusy(true);
                        setMessage("");
                        void window.lanvory
                          .discoverServices(adapter, endpoint, selectedDevice)
                          .then((raw) => {
                            const parsed = z.array(z.string()).safeParse(raw);
                            if (parsed.success) {
                              setDiscoveredServices(parsed.data);
                              setLastServiceConn({ adapter, endpoint });
                              onRoute?.({ fingerprint: selectedDevice, adapter, endpoint });
                              if (parsed.data.length === 1 && !serviceNameInput) {
                                setServiceNameInput(parsed.data[0]);
                              }
                              if (parsed.data.length === 0) {
                                setMessage("No services are currently shared with this device.");
                              }
                            } else {
                              const errText = raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
                                ? raw.error
                                : "Unable to discover shared services.";
                              setMessage(errText);
                            }
                          })
                          .finally(() => setDiscoverBusy(false));
                      }}
                    >
                      <Search size={14} aria-hidden="true" />
                      <span>{discoverBusy ? "Finding…" : "Find shared services"}</span>
                    </button>
                  </div>
                  {discoveredServices.length > 0 && (
                    <div className="service-grants-list" style={{ marginTop: 4 }}>
                      <div className="service-sub-label">
                        Available on {pairedDeviceName(selectedDevice, names)} ({discoveredServices.length})
                      </div>
                      {discoveredServices.map((svcId) => (
                        <div className="service-grant-row" key={svcId}>
                          <div className="service-grant-info">
                            <Server size={14} className="service-device-icon" aria-hidden="true" />
                            <strong className="service-grant-name">{svcId}</strong>
                          </div>
                          <button
                            type="button"
                            className="primary"
                            style={{ minHeight: 28, padding: "0 12px", fontSize: ".78rem" }}
                            disabled={busy}
                            onClick={() => {
                              const conn = lastServiceConn ?? (usingP2PRoute ? route : undefined);
                              if (!conn) return;
                              void update("open", {
                                id: svcId,
                                fingerprint: selectedDevice,
                                adapter: conn.adapter,
                                endpoint: conn.endpoint,
                                bind: "127.0.0.1:0",
                              });
                            }}
                          >
                            Connect
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label>
                    Service name on the sharing device
                    <input
                      name="id"
                      required
                      maxLength={64}
                      pattern="[a-z0-9][a-z0-9_\-]{0,63}"
                      value={serviceNameInput}
                      onChange={(e) => setServiceNameInput(e.target.value)}
                      placeholder="Name from the other device"
                    />
                  </label>
                  <details className="trust-details services-connection">
                    <summary>Advanced · Address on this device</summary>
                    <label>
                      Tunnel address on this device (optional)
                      <input
                        name="bind"
                        defaultValue="127.0.0.1:0"
                        aria-describedby="services-bind-help"
                        readOnly={busy}
                      />
                    </label>
                    <p id="services-bind-help">
                      Keep 127.0.0.1:0 to choose a port automatically.
                    </p>
                  </details>
                  <button
                    className="refresh"
                    type="submit"
                    disabled={busy || (!usingP2PRoute && !connectionReady)}
                  >
                    <Plug size={16} aria-hidden="true" />
                    Connect to service
                  </button>
                </div>
              )}
            </form>
          )}
          {!!snapshot?.tunnels.length && (
            <div className="services-section-divider">
              <span className="services-section-title">
                Connections on this device
              </span>
              <span className="tag">{snapshot.tunnels.length}</span>
            </div>
          )}
          {snapshot?.tunnels.map((tunnel) => (
            <div className="sharing-item service-card" key={tunnel.id}>
              <div className="service-card-header">
                <div className="service-card-identity">
                  <div className="service-icon-box">
                    <Server size={18} aria-hidden="true" />
                  </div>
                  <div className="service-meta">
                    <div className="service-title-row">
                      <strong className="service-name">{tunnel.service}</strong>
                      <button
                        type="button"
                        className="service-target-badge service-target-link"
                        title={`Open http://${tunnel.bind} in browser`}
                        onClick={() =>
                          void window.lanvory.openTunnelUrl(tunnel.bind).then((opened) => {
                            if (!opened) {
                              setMessage(`Unable to open http://${tunnel.bind} in your browser.`);
                            }
                          })
                        }
                      >
                        <span
                          className="service-status-dot"
                          aria-hidden="true"
                        />
                        <span>Open {tunnel.bind} on this device</span>
                        <ExternalLink
                          size={12}
                          aria-hidden="true"
                          className="service-link-icon"
                        />
                      </button>
                      <span className="service-grant-meta">
                        {tunnel.connections} active
                      </span>
                    </div>
                    {tunnel.lastError && (
                      <div className="service-access-hint" style={{ color: "#f87171", marginTop: 4 }}>
                        <span>Last error: {tunnel.lastError}</span>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="refresh service-action-icon-btn"
                  title="Disconnect"
                  aria-label="Disconnect"
                  disabled={busy}
                  onClick={() => void update("stop", { id: tunnel.id })}
                >
                  <X size={15} aria-hidden="true" />
                  <span className="sr-only">Disconnect</span>
                </button>
              </div>
            </div>
          ))}
        </section>
      </WorkspaceTabPanel>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

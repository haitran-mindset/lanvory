import { useEffect, useState } from "react";
import { Clipboard, Copy, Send, ShieldCheck, Trash2 } from "lucide-react";
import { z } from "zod";
import { useNotifications } from "../../components/notifications";
import { SelectField } from "../../components/ui/select";
import {
  isP2PRoute,
  lanSuggestedEndpoint,
  PeerConnectionFields,
} from "../../components/peer-connection-fields";
import { pairedDeviceName, readPairedNames } from "../../services/paired-names";
import type { PeerRoute } from "./sharing";

const clipboardStateSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  latest: z
    .object({
      text: z.string(),
      sha256: z.string(),
      originFingerprint: z.string(),
      receivedAt: z.string(),
    })
    .optional(),
});

type ClipboardState = z.infer<typeof clipboardStateSchema>;

export function ClipboardCard({
  ownerId,
  visible,
  recipients,
  routes,
}: {
  ownerId?: string;
  visible: boolean;
  recipients: Array<{ fingerprint: string }> | null | undefined;
  routes: Record<string, PeerRoute>;
}) {
  const { notify } = useNotifications();
  const [state, setState] = useState<ClipboardState | null>();
  const [allowedPeers, setAllowedPeers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [peer, setPeer] = useState("");
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const names = ownerId ? readPairedNames(ownerId) : {};

  useEffect(() => {
    if (!visible) return;
    let active = true;
    async function load() {
      const [rawState, grants] = await Promise.all([
        window.lanvory.clipboardState().catch(() => null),
        window.lanvory.clipboardAccess().catch(() => null),
      ]);
      const parsed = clipboardStateSchema.safeParse(rawState);
      if (!active) return;
      setState(parsed.success ? parsed.data : null);
      if (Array.isArray(grants)) setAllowedPeers(grants);
    }
    void load();
    return () => {
      active = false;
    };
  }, [visible]);

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    setMessage("");
    const parsed = clipboardStateSchema.safeParse(
      await window.lanvory.setClipboardPolicy(enabled).catch(() => null),
    );
    if (parsed.success) {
      setState(parsed.data);
      notify({
        category: "clipboard",
        tone: enabled ? "success" : "info",
        title: enabled ? "Shared clipboard enabled." : "Shared clipboard disabled.",
      });
    } else {
      setMessage("Unable to update clipboard policy.");
    }
    setBusy(false);
  }

  async function sendSnippet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeRoute = routes[peer];
    const useP2P = isP2PRoute(activeRoute);
    if (!peer || (!useP2P && !ready)) return;
    const form = new FormData(event.currentTarget);
    const adapter = useP2P
      ? activeRoute.adapter
      : String(form.get("adapter") ?? "").trim();
    const endpoint = useP2P
      ? activeRoute.endpoint
      : String(form.get("endpoint") ?? "").trim();
    setBusy(true);
    setMessage("");
    const res = await window.lanvory
      .sendClipboard(adapter, endpoint, peer, text.trim() || undefined)
      .catch(() => ({ ok: false, error: "Unable to send clipboard." }));
    if (res.ok) {
      setText("");
      notify({ category: "clipboard", tone: "success", title: "Clipboard snippet sent." });
    } else {
      setMessage(res.error ?? "Unable to send clipboard snippet.");
    }
    setBusy(false);
  }

  const route = routes[peer];
  const isPeerAllowed = peer ? allowedPeers?.includes(peer) === true : false;

  return (
    <section id="sharing-clipboard" className="operation-card clipboard-workspace" tabIndex={-1} aria-labelledby="clipboard-heading">
      <div className="clipboard-workspace-heading">
        <div className="clipboard-workspace-title">
          <Clipboard size={21} aria-hidden="true" />
          <div>
            <h3 id="clipboard-heading">Shared clipboard</h3>
            <p>Send text to a paired device. Received snippets stay in Lanvory until you copy them.</p>
          </div>
        </div>
        <button type="button" role="switch" aria-checked={state?.enabled === true}
          aria-label="Enable shared clipboard for this session" className="clipboard-session-switch"
          disabled={busy || state === undefined} onClick={() => void toggleEnabled(state?.enabled !== true)}>
          <span>{state?.enabled ? "Session enabled" : "Session disabled"}</span>
          <span className="clipboard-switch-track" aria-hidden="true" />
        </button>
      </div>
      {state !== undefined && !state?.enabled && (
        <p className="clipboard-session-note">Enable clipboard sharing for this session to send or receive snippets.</p>
      )}

      {state?.enabled && (
        <div className="clipboard-body">
          {recipients && recipients.length > 0 ? (
            <>
              <div className="clipboard-section">
                <SelectField
                  label="Paired device"
                  name="clipboardPeer"
                  required
                  placeholder="Select a paired device"
                  value={peer}
                  disabled={busy}
                  onValueChange={setPeer}
                  options={recipients.map(({ fingerprint }) => ({
                    value: fingerprint,
                    label: pairedDeviceName(fingerprint, names),
                  }))}
                />
                <div className="clipboard-permission-bar">
                  <div className="clipboard-permission-copy">
                    <div className="clipboard-permission-title-row">
                      <strong>Incoming clipboard access</strong>
                      {peer && isPeerAllowed && (
                        <span className="clipboard-status-badge">Allowed</span>
                      )}
                    </div>
                    <small>
                      {!peer
                        ? "Select a paired device above to allow incoming snippets."
                        : isPeerAllowed
                          ? `${pairedDeviceName(peer, names)} can send snippets to this device.`
                          : `Allow ${pairedDeviceName(peer, names)} to send snippets to this device.`}
                    </small>
                  </div>
                  {peer && (
                    <div className="clipboard-permission-actions">
                      {isPeerAllowed ? (
                        <button
                          type="button"
                          className="refresh"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void window.lanvory
                              .setClipboardAccess(peer, false)
                              .then((ok) => {
                                if (ok) {
                                  setAllowedPeers((prev) =>
                                    (prev ?? []).filter((fp) => fp !== peer),
                                  );
                                  setMessage("");
                                  notify({
                                    category: "clipboard",
                                    tone: "info",
                                    title: `Revoked clipboard sharing for ${pairedDeviceName(peer, names)}.`,
                                  });
                                } else {
                                  setMessage("Unable to revoke clipboard permission.");
                                }
                              })
                              .finally(() => setBusy(false));
                          }}
                        >
                          Revoke
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="refresh"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void window.lanvory
                              .setClipboardAccess(peer, true, "until-revoked")
                              .then((ok) => {
                                if (ok) {
                                  setAllowedPeers((prev) =>
                                    prev?.includes(peer)
                                      ? prev
                                      : [...(prev ?? []), peer],
                                  );
                                  setMessage("");
                                  notify({
                                    category: "clipboard",
                                    tone: "success",
                                    title: `Allowed clipboard sharing with ${pairedDeviceName(peer, names)}.`,
                                  });
                                } else {
                                  setMessage("Unable to grant clipboard permission.");
                                }
                              })
                              .finally(() => setBusy(false));
                          }}
                        >
                          Allow peer
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {peer && (
                <form
                  className="trust-form clipboard-send-form"
                  onSubmit={(e) => void sendSnippet(e)}
                >
                  <h4 className="clipboard-composer-title">Send a snippet</h4>
                  {isP2PRoute(route) ? (
                    <div className="paired-device-meta-row">
                      <span className="paired-method-badge is-p2p">
                        Bluetooth + Wi-Fi P2P
                      </span>
                    </div>
                  ) : (
                    <details
                      className="trust-details clipboard-connection-details"
                      key={peer}
                      open={!route || !ready}
                    >
                      <summary>Connection address</summary>
                      <PeerConnectionFields
                        suggestedEndpoint={lanSuggestedEndpoint(route)}
                        disabled={busy}
                        onReady={setReady}
                      />
                    </details>
                  )}
                  <label>
                    Text snippet
                    <textarea
                      rows={3}
                      value={text}
                      maxLength={2048}
                      placeholder="Type or paste text…"
                      disabled={busy}
                      onChange={(e) => setText(e.currentTarget.value)}
                    />
                  </label>
                  <div className="clipboard-send-actions">
                    <small>{text.trim() ? "Sends the text above" : "Uses your system clipboard · up to 64 KiB"}</small>
                    <button
                      type="submit"
                      className="primary clipboard-send-btn"
                      disabled={busy || !peer || (!isP2PRoute(route) && !ready)}
                    >
                      <Send size={14} aria-hidden="true" /> {text.trim() ? "Send snippet" : "Send clipboard"}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p className="panel-empty">
              Pair a device first to send or receive clipboard snippets.
            </p>
          )}

          {state.latest && (
            <div className="clipboard-latest">
              <div className="clipboard-latest-header">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>
                  Received from{" "}
                  {pairedDeviceName(state.latest.originFingerprint, names)}
                </span>
                <div className="clipboard-latest-actions">
                  <button
                    type="button"
                    className="refresh"
                    onClick={() => {
                      void window.lanvory
                        .copyReceivedClipboard(state.latest!.text)
                        .then((ok) => {
                          if (ok) {
                            setMessage("");
                            notify({ category: "clipboard", tone: "success", title: "Copied received snippet to clipboard." });
                          } else {
                            setMessage("Unable to copy.");
                          }
                        });
                    }}
                  >
                    <Copy size={14} aria-hidden="true" /> Copy
                  </button>
                  <button
                    type="button"
                    className="refresh"
                    aria-label="Clear received snippet"
                    onClick={() => {
                      void window.lanvory.clearClipboard().then(() => {
                        setState((prev) =>
                          prev ? { ...prev, latest: undefined } : prev,
                        );
                      });
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <pre className="clipboard-preview">{state.latest.text}</pre>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className="sharing-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Clipboard, Copy, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { PanelHeading } from '../../components/panel-heading';
import { Checkbox } from '../../components/ui/checkbox';
import { SelectField } from '../../components/ui/select';
import { PeerConnectionFields } from '../../components/peer-connection-fields';
import { pairedDeviceName, readPairedNames } from '../../services/paired-names';
import type { PeerRoute } from './sharing';

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
  const [state, setState] = useState<ClipboardState | null>();
  const [busy, setBusy] = useState(false);
  const [peer, setPeer] = useState('');
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const names = ownerId ? readPairedNames(ownerId) : {};

  useEffect(() => {
    if (!visible) return;
    let active = true;
    async function load() {
      const parsed = clipboardStateSchema.safeParse(
        await window.lanvory.clipboardState().catch(() => null),
      );
      if (active) setState(parsed.success ? parsed.data : null);
    }
    void load();
    return () => {
      active = false;
    };
  }, [visible]);

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    setMessage('');
    const parsed = clipboardStateSchema.safeParse(
      await window.lanvory.setClipboardPolicy(enabled).catch(() => null),
    );
    if (parsed.success) {
      setState(parsed.data);
      setMessage(enabled ? 'Shared clipboard enabled (manual opt-in).' : 'Shared clipboard disabled.');
    } else {
      setMessage('Unable to update clipboard policy.');
    }
    setBusy(false);
  }

  async function sendSnippet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!peer || !ready) return;
    const form = new FormData(event.currentTarget);
    const adapter = String(form.get('adapter') ?? '').trim();
    const endpoint = String(form.get('endpoint') ?? '').trim();
    setBusy(true);
    setMessage('');
    const res = await window.lanvory
      .sendClipboard(adapter, endpoint, peer, text.trim() || undefined)
      .catch(() => ({ ok: false, error: 'Unable to send clipboard.' }));
    if (res.ok) {
      setText('');
      setMessage('Clipboard snippet validated and marked sent (loop prevention active).');
    } else {
      setMessage(res.error ?? 'Unable to send clipboard snippet.');
    }
    setBusy(false);
  }

  const route = routes[peer];

  return (
    <section className="operation-card" aria-labelledby="clipboard-heading">
      <PanelHeading
        icon={Clipboard}
        id="clipboard-heading"
        title="Shared clipboard"
        description="Disabled by default. Share text snippets explicitly with a trusted peer (max 64 KiB, no auto-paste)."
      />
      <label className="settings-toggle clipboard-toggle">
        <span>
          Enable shared clipboard
          <small>Opt-in per session with SHA-256 loop prevention.</small>
        </span>
        <Checkbox
          aria-label="Enable shared clipboard"
          checked={state?.enabled === true}
          disabled={busy || state === undefined}
          onCheckedChange={(checked) => void toggleEnabled(checked === true)}
        />
      </label>

      {state?.enabled && (
        <div className="clipboard-body">
          {recipients && recipients.length > 0 ? (
            <form className="trust-form" onSubmit={(e) => void sendSnippet(e)}>
              <SelectField
                label="Trusted peer"
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
              {peer && (
                <PeerConnectionFields
                  suggestedEndpoint={route?.endpoint}
                  disabled={busy}
                  onReady={setReady}
                />
              )}
              <label>
                Text snippet (leave empty to read current OS clipboard)
                <input
                  type="text"
                  value={text}
                  maxLength={2048}
                  placeholder="Enter text or leave blank to use current clipboard"
                  disabled={busy}
                  onChange={(e) => setText(e.currentTarget.value)}
                />
              </label>
              <div className="clipboard-send-actions">
                <button type="submit" className="refresh" disabled={busy || !peer || !ready}>
                  <Send size={14} aria-hidden="true" /> Send clipboard
                </button>
                <button
                  type="button"
                  className="refresh"
                  disabled={busy || !peer}
                  onClick={() => {
                    setBusy(true);
                    void window.lanvory
                      .setClipboardAccess(peer, true, 'until-revoked')
                      .then((ok) => {
                        setMessage(ok ? `Allowed clipboard sharing with ${pairedDeviceName(peer, names)}.` : 'Unable to grant clipboard permission.');
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Allow peer
                </button>
                <button
                  type="button"
                  className="refresh"
                  disabled={busy || !peer}
                  onClick={() => {
                    setBusy(true);
                    void window.lanvory
                      .setClipboardAccess(peer, false)
                      .then((ok) => {
                        setMessage(ok ? `Revoked clipboard sharing for ${pairedDeviceName(peer, names)}.` : 'Unable to revoke clipboard permission.');
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Revoke
                </button>
              </div>
            </form>
          ) : (
            <p className="panel-empty">Pair a device and grant clipboard-share permission to send snippets.</p>
          )}

          {state.latest && (
            <div className="clipboard-latest">
              <div className="clipboard-latest-header">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>Received from {pairedDeviceName(state.latest.originFingerprint, names)}</span>
                <div className="clipboard-latest-actions">
                  <button
                    type="button"
                    className="refresh"
                    onClick={() => {
                      void window.lanvory.copyReceivedClipboard(state.latest!.text).then((ok) => {
                        setMessage(ok ? 'Copied received snippet to clipboard.' : 'Unable to copy.');
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
                        setState((prev) => (prev ? { ...prev, latest: undefined } : prev));
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

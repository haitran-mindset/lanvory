import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Fingerprint, Link2, Monitor, ShieldCheck, X } from 'lucide-react';
import { z } from 'zod';
import { connectionError, endpointAddress, PeerConnectionFields } from '../../components/peer-connection-fields';
import { Checkbox } from '../../components/ui/checkbox';
import type { PairingTarget } from './nearby';

const requestsSchema = z.array(z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  direction: z.enum(['incoming', 'outgoing']),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime(),
  code: z.string().regex(/^(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/),
}));

type Requests = z.infer<typeof requestsSchema>;
const trustedPeersSchema = z.array(z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }));

function pairingNumbers(answer: number) {
  const randomBelow = (limit: number) => {
    const threshold = 65536 - 65536 % limit;
    const sample = new Uint16Array(1);
    do { crypto.getRandomValues(sample); } while (sample[0] >= threshold);
    return sample[0] % limit;
  };
  const values = new Set([answer]);
  while (values.size < 3) values.add(randomBelow(100));
  const [correct, first, second] = [...values];
  const options = [first, second];
  options.splice(randomBelow(3), 0, correct);
  return options;
}

function PairingApproval({ request, locked, error, onDecide }: {
  request: Requests[number];
  locked: boolean;
  error: string;
  onDecide(approved: boolean, code?: string): void;
}) {
  const incoming = request.direction === 'incoming';
  const number = Number.parseInt(request.code.slice(0, 8), 16) % 100;
  const [options] = useState(() => incoming ? pairingNumbers(number) : []);
  const [selected, setSelected] = useState<number>();
  const [compared, setCompared] = useState(false);
  const [wrongNumber, setWrongNumber] = useState(false);

  return (
    <form className="trust-form pairing-form" onSubmit={(event) => {
      event.preventDefault();
      if (locked || !compared || (incoming && selected === undefined)) return;
      if (incoming && selected !== number) {
        setWrongNumber(true);
        return;
      }
      onDecide(true, request.code);
    }}>
      {incoming ? (
        <fieldset className="pairing-number-field" disabled={locked}>
          <legend>Which number is shown on the other device?</legend>
          <div className="pairing-number-options">
            {options.map((value) => (
              <button type="button" className="pairing-number" key={value} aria-pressed={selected === value}
                onClick={() => { setSelected(value); setWrongNumber(false); }}>{value}</button>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="pairing-number-display">
          <span>Show this number to the other person</span>
          <strong className="pairing-number">{number}</strong>
        </div>
      )}
      <details className="trust-details pairing-verification">
        <summary>Compare verification code</summary>
        <code className="pairing-code">{request.code}</code>
      </details>
      <label className="checkbox pairing-compare">
        <Checkbox checked={compared} disabled={locked} onCheckedChange={(checked) => setCompared(checked === true)} />
        The code matches on both devices.
      </label>
      <div className="pairing-actions">
        <button type="submit" className="primary" disabled={locked || !compared || (incoming && selected === undefined)}>Approve pairing</button>
        <button type="button" className="refresh" disabled={locked} onClick={() => onDecide(false)}>Decline</button>
      </div>
      {wrongNumber && <p role="alert">The number doesn’t match. Check the other device before trying again.</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function PairingPanel({ selection, onClearTarget, onNetwork, visible, onChange, onPaired }: {
  selection: { revision: number; target?: PairingTarget };
  onClearTarget(): void;
  onNetwork(): void;
  visible: boolean;
  onChange(): void;
  onPaired(peer: { fingerprint: string; adapter: string; endpoint: string; label?: string }): void;
}) {
  const { target, revision } = selection;
  const [sampledAt, setSampledAt] = useState(Date.now);
  const [pastedEndpoint, setPastedEndpoint] = useState<{ revision: number; value: string }>();
  const [connectionReady, setConnectionReady] = useState(false);
  const [requests, setRequests] = useState<Requests | null>();
  const [starting, setStarting] = useState(false);
  const [requestStarted, setRequestStarted] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [message, setMessage] = useState('');

  const dialog = useRef<HTMLDialogElement>(null);
  const requestsRevision = useRef(0);
  const [decisionError, setDecisionError] = useState('');
  const request = requests?.[0];
  const requestId = request?.id;
  const isReviewing = visible && requestId !== undefined;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isReviewing) {
      if (!element.open) element.showModal();
    } else if (element.open) {
      element.close();
    }
  }, [isReviewing, requestId]);

  useEffect(() => { setDecisionError(''); }, [requestId]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const revision = requestsRevision.current;
      const parsed = requestsSchema.safeParse(await window.lanvory.pairingRequests().catch(() => null));
      if (!active) return;
      setSampledAt(Date.now());
      if (revision === requestsRevision.current) setRequests(parsed.success ? parsed.data : null);
      timer = setTimeout(load, 1000);
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [visible]);

  const fingerprintField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (visible && target) fingerprintField.current?.focus();
  }, [revision, target, visible]);

  function pastePairingDetails(event: ClipboardEvent<HTMLInputElement>) {
    if (starting) return;
    const text = event.clipboardData.getData('text/plain').trim();
    const match = /^Lanvory pairing\r?\nAddress: ([0-9.]+):([0-9]{1,5})\r?\nDevice ID: ([a-f0-9]{64})$/i.exec(text);
    if (!match) return;
    event.preventDefault();
    const endpoint = `${match[1]}:${match[2]}`;
    if (!endpointAddress(endpoint)) {
      setMessage('The pasted pairing details contain an invalid address.');
      return;
    }
    setPastedEndpoint({ revision, value: endpoint });
    event.currentTarget.value = match[3].toLowerCase();
    setMessage('Pairing details filled in. Review them before sending a request.');
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (name: string) => String(form.get(name) ?? '').trim();
    setStarting(true);
    setMessage('Checking the local network adapter…');
    try {
      const adapter = get('adapter');
      const endpoint = get('endpoint');
      const error = await connectionError(adapter, endpoint);
      if (error) {
        setMessage(error);
        return;
      }
      const fingerprint = get('fingerprint').toLowerCase();
      const route = { fingerprint, adapter, endpoint, label: target?.endpoints.includes(endpoint) ? target.name : undefined };
      setMessage('Checking whether this device is already paired…');
      const matched = await window.lanvory.matchTrustedPeer(adapter, endpoint);
      if (matched === fingerprint) {
        onPaired(route);
        setMessage('Already paired. Connection details updated.');
        return;
      }
      if (matched) {
        setMessage('This address belongs to a different paired device. Check the Device ID.');
        return;
      }
      const trusted = trustedPeersSchema.safeParse(await window.lanvory.trustedPeers());
      if (!trusted.success) {
        setMessage('Unable to check paired devices. Try again.');
        return;
      }
      if (trusted.data.some((item) => item.fingerprint.toLowerCase() === fingerprint)) {
        setMessage('This device is already paired, but its Device ID could not be verified at this address. Check its LAN address and try again.');
        return;
      }
      setRequestStarted(true);
      setMessage('Waiting for both devices to approve the request.');
      const result = await window.lanvory.startPairing(adapter, endpoint, fingerprint);
      if (result === 'paired') onPaired(route);
      setMessage(result === 'paired' ? 'Both devices saved trust.' : result === 'cancelled'
        ? 'Stopped waiting for pairing. Check Paired devices if both devices had already approved.'
        : 'Pairing did not complete.');
      if (result !== 'failed') onChange();
    } catch {
      setMessage('Unable to start pairing.');
    } finally {
      setStarting(false);
      setRequestStarted(false);
      setCancelling(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await window.lanvory.cancelPairing();
    } catch {
      setMessage('Unable to cancel the request.');
      setCancelling(false);
    }
  }

  async function decide(request: Requests[number], approved: boolean, code?: string) {
    if (Date.parse(request.expiresAt) <= Date.now()) {
      setDecisionError('This pairing request has expired.');
      return;
    }
    const { id } = request;
    setDeciding(true);
    setDecisionError('');
    try {
      const ok = await window.lanvory.decidePairing(id, approved, code);
      if (ok) {
        requestsRevision.current += 1;
        setRequests((previous) => previous?.filter((request) => request.id !== id) ?? previous);
      }
      if (ok) setMessage(approved ? 'You approved the request. Wait for the other device.' : 'Pairing declined.');
      else setDecisionError(approved ? 'The code did not match or the request is no longer available.'
        : 'Unable to cancel this pairing request. Try again.');
      if (ok && approved) onChange();
    } catch {
      setDecisionError('Unable to submit the pairing decision.');
    } finally {
      setDeciding(false);
    }
  }

  const startForm = (
    <form className="trust-form pairing-form" onSubmit={(event) => void start(event)}>
      <PeerConnectionFields key={revision}
        suggestedEndpoint={pastedEndpoint?.revision === revision ? pastedEndpoint.value : target?.endpoints[0]}
        endpoints={target?.endpoints} disabled={starting} onReady={setConnectionReady} />
      {!connectionReady && <button type="button" className="refresh" onClick={onNetwork}>Open Network settings</button>}
      <label>
        <span className="pairing-label"><Fingerprint size={16} aria-hidden="true" /> Device ID</span>
        <input name="fingerprint" ref={fingerprintField} required maxLength={64} pattern="[A-Fa-f0-9]{64}"
          onPaste={pastePairingDetails} autoComplete="off" spellCheck={false} aria-describedby="pairing-fingerprint-help" />
      </label>
      <p id="pairing-fingerprint-help">On the other device, open <strong>Devices → My device → View device ID</strong>. Ask for the ID through a trusted channel, then paste it here. {!target && <>You can also paste the text from <strong>Copy pairing details</strong> here to fill in the address.</>}</p>
      {target && <button type="button" className="pairing-link" onClick={onClearTarget} disabled={starting}>Clear discovered address</button>}
      <div className="pairing-actions">
        <button type="submit" className="primary" disabled={starting || !requests || !connectionReady}>
          {starting ? 'Pairing…' : 'Send pairing request'} <ArrowRight size={16} aria-hidden="true" />
        </button>
        {requestStarted && <button type="button" className="refresh" disabled={cancelling} onClick={() => void cancel()}>
          {cancelling ? 'Cancelling…' : 'Cancel request'}
        </button>}
      </div>
    </form>
  );

  return (
    <section className="nearby pairing-panel" aria-labelledby="pairing-heading">
      <div className="device-discovery-heading pairing-panel-heading">
        <span className="device-discovery-emblem">
          <Link2 size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id="pairing-heading" tabIndex={-1}>Pair a Device</h3>
          <p>Connect a new device to your network.</p>
        </div>
      </div>
      {requests === null && <p role="status">Unable to read pairing requests.</p>}
      <dialog ref={dialog} className="pairing-dialog" aria-labelledby="confirm-pairing-title"
        aria-describedby="confirm-pairing-help" onCancel={(event) => {
          event.preventDefault();
          if (request && !deciding) void decide(request, false);
        }}>
      {request && (() => {
        const remaining = Math.max(0, Math.ceil((Date.parse(request.expiresAt) - sampledAt) / 1000));
        return (
          <div className="pairing-confirmation" key={request.id}>
            <div className="pairing-card-heading">
              <h4 id="confirm-pairing-title"><ShieldCheck size={19} aria-hidden="true" /> Confirm pairing</h4>
              <button className="pairing-dismiss" type="button" aria-label="Cancel pairing request" disabled={deciding}
                onClick={() => void decide(request, false)}><X size={20} aria-hidden="true" /></button>
            </div>
            <span className="pairing-expiry"><Clock3 size={15} aria-hidden="true" /> {remaining > 0
                ? <time dateTime={request.expiresAt}>{remaining} s left</time> : 'Expired'}</span>
            <p id="confirm-pairing-help">Match the number, then compare the verification code before approving.</p>
            <PairingApproval request={request} locked={deciding || remaining === 0} error={decisionError}
              onDecide={(approved, code) => void decide(request, approved, code)} />
            <details className="trust-details pairing-options"><summary>Device ID</summary><code>{request.fingerprint}</code></details>
          </div>
        );
      })()}
      </dialog>
      {target ? (
        <article className="pairing-card" key={revision}>
          <div className="pairing-card-heading">
            <span className="pairing-device-icon"><Monitor size={23} aria-hidden="true" /></span>
            <div><p>Selected device</p><h4>{target.name}</h4></div>
          </div>
          {startForm}
        </article>
      ) : (
        <details className="pairing-card pairing-manual" key={revision} open={revision > 0 || undefined}>
          <summary>Pair by address</summary>
          {startForm}
        </details>
      )}
      {message && <p className="pairing-feedback" role="status">{message}</p>}
    </section>
  );
}

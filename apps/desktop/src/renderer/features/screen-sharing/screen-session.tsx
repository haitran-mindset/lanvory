import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import { SelectField } from '../../components/ui/select';
import { pairedDeviceName } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';

const format = 'jpeg/1';
const frameInterval = 83;
const maxFrameBytes = 42 * 1024;
const frameProfiles = [
  { width: 1280, quality: 0.68 },
  { width: 960, quality: 0.62 },
  { width: 640, quality: 0.6 },
  { width: 480, quality: 0.54 },
];
const invitation = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  peer: z.string().regex(/^[a-f0-9]{64}$/),
  offer: z.literal(format),
});
const view = z.object({
  state: z.string(),
  answer: z.string().optional(),
  frame: z.string().max(57344).optional(),
  sequence: z.number().int().positive().optional(),
});
type Invitation = z.infer<typeof invitation>;
type Session =
  | { id: string; direction: 'send'; route: PeerRoute }
  | { id: string; direction: 'view'; peer: string };

function tell(route: PeerRoute, signal: object) {
  return window.lanvory
    .screenSignaling('send', {
      adapter: route.adapter,
      endpoint: route.endpoint,
      fingerprint: route.fingerprint,
      signal,
    })
    .catch(() => null);
}

function end(session: Session) {
  return session.direction === 'send'
    ? tell(session.route, { action: 'stop', id: session.id })
    : window.lanvory
        .screenSignaling('stop', { id: session.id })
        .catch(() => null);
}

async function encodeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  level: number,
) {
  if (!video.videoWidth || !video.videoHeight) return undefined;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return undefined;
  for (let index = level; index < frameProfiles.length; index++) {
    const { width, quality } = frameProfiles[index];
    const ratio = Math.min(
      1,
      width / video.videoWidth,
      900 / video.videoHeight,
    );
    const w = Math.max(1, Math.round(video.videoWidth * ratio));
    const h = Math.max(1, Math.round(video.videoHeight * ratio));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.drawImage(video, 0, 0, w, h);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!jpeg || jpeg.size > maxFrameBytes) continue;
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    return { frame: btoa(String.fromCharCode(...bytes)), level: index };
  }
}

export function ScreenSession({
  video,
  captureActive,
  stopCapture,
  routes,
  names,
}: {
  video: RefObject<HTMLVideoElement | null>;
  captureActive: boolean;
  stopCapture(): void;
  routes: Record<string, PeerRoute>;
  names: Record<string, string>;
}) {
  const [target, setTarget] = useState('');
  const [incoming, setIncoming] = useState<Invitation>();
  const [session, setSession] = useState<Session>();
  const [phase, setPhase] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef<Session | undefined>(undefined);
  const frameURL = useRef('');
  const epoch = useRef(0);
  const stopCaptureRef = useRef(stopCapture);
  stopCaptureRef.current = stopCapture;
  const choices = Object.values(routes).filter(
    (route) => route.adapter !== 'p2p',
  );

  function clearFrame() {
    if (frameURL.current) URL.revokeObjectURL(frameURL.current);
    frameURL.current = '';
  }

  function finish(message: string) {
    const old = current.current;
    current.current = undefined;
    epoch.current++;
    if (old) {
      void end(old);
      if (old.direction === 'send') stopCaptureRef.current();
    }
    clearFrame();
    setImage('');
    setSession(undefined);
    setBusy(false);
    setPhase(message);
  }

  useEffect(
    () => () => {
      epoch.current++;
      if (current.current) void end(current.current);
      current.current = undefined;
      clearFrame();
    },
    [],
  );

  useEffect(() => {
    if (!captureActive && current.current?.direction === 'send')
      finish('Screen capture ended.');
  }, [captureActive]);

  useEffect(() => {
    if (session || busy) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await window.lanvory
        .screenSignaling('pending')
        .catch(() => null);
      if (disposed) return;
      const parsed = z.array(invitation).safeParse(result);
      setIncoming(parsed.success ? parsed.data[0] : undefined);
      timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [session, busy]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let sequence = 0;
    let accepted = false;
    let level = 0;
    let fastFrames = 0;
    let lastFrame = Date.now();
    const canvas = document.createElement('canvas');

    async function tick() {
      if (!session || disposed || current.current !== session) return;
      const start = performance.now();
      if (session.direction === 'send') {
        if (!video.current) return;
        let signal: object = { id: session.id, action: 'status' };
        if (accepted && video.current.readyState >= 2) {
          const encoded = await encodeFrame(video.current, canvas, level).catch(
            () => undefined,
          );
          if (disposed || current.current !== session) return;
          if (encoded) {
            level = encoded.level;
            signal = {
              id: session.id,
              action: 'frame',
              frame: encoded.frame,
              sequence: ++sequence,
            };
          }
        }
        const reply = view.safeParse(await tell(session.route, signal));
        if (disposed) return;
        if (
          !reply.success ||
          !['pending', 'accepted'].includes(reply.data.state)
        ) {
          finish(
            reply.success && reply.data.state === 'declined'
              ? 'Invitation declined.'
              : 'The screen-sharing session ended.',
          );
          return;
        }
        if (!accepted && reply.data.state === 'accepted') {
          if (reply.data.answer !== format) {
            finish('This device does not support the screen-sharing format.');
            return;
          }
          accepted = true;
          setPhase('Sharing your screen');
        }
        if (accepted && performance.now() - start > 130) {
          level = Math.min(level + 1, frameProfiles.length - 1);
          fastFrames = 0;
        } else if (
          accepted &&
          level > 0 &&
          performance.now() - start < 50 &&
          ++fastFrames >= 24
        ) {
          level--;
          fastFrames = 0;
        }
      } else {
        const raw = await window.lanvory
          .screenSignaling('view', { id: session.id, after: sequence })
          .catch(() => null);
        if (disposed) return;
        const reply = view.safeParse(raw);
        if (
          !reply.success ||
          reply.data.state !== 'accepted' ||
          Date.now() - lastFrame > 8000
        ) {
          finish(
            'The screen-sharing session ended or the connection was lost.',
          );
          return;
        }
        const { frame, sequence: next } = reply.data;
        if (!frame && Date.now() - lastFrame > 3000 && frameURL.current) {
          clearFrame();
          setImage('');
        }
        if (frame && next && next > sequence) {
          try {
            const bytes = Uint8Array.from(atob(frame), (byte) =>
              byte.charCodeAt(0),
            );
            const url = URL.createObjectURL(
              new Blob([bytes], { type: 'image/jpeg' }),
            );
            const nextImage = new Image();
            nextImage.src = url;
            try {
              await nextImage.decode();
            } catch {
              URL.revokeObjectURL(url);
              if (!disposed && current.current === session)
                finish('Could not display the received screen.');
              return;
            }
            if (disposed || current.current !== session) {
              URL.revokeObjectURL(url);
              return;
            }
            clearFrame();
            frameURL.current = url;
            setImage(url);
            sequence = next;
            lastFrame = Date.now();
          } catch {
            finish('Could not display the received screen.');
            return;
          }
        }
      }
      const interval =
        accepted || session.direction === 'view' ? frameInterval : 500;
      timer = setTimeout(
        tick,
        Math.max(0, interval - (performance.now() - start)),
      );
    }

    void tick();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [session, video]);

  async function invite() {
    const route = routes[target];
    if (!captureActive || !route || route.adapter === 'p2p' || current.current)
      return;
    const id = crypto.randomUUID().replaceAll('-', '');
    const next: Session = { id, direction: 'send', route };
    current.current = next;
    const generation = ++epoch.current;
    setBusy(true);
    const reply = view.safeParse(
      await tell(route, {
        action: 'offer',
        id,
        offer: format,
        createdAt: new Date().toISOString(),
      }),
    );
    if (epoch.current !== generation) {
      void end(next);
      return;
    }
    if (!reply.success || reply.data.state !== 'pending') {
      finish(
        'Could not invite this device. Check its LAN connection and Screen Sharing availability.',
      );
      return;
    }
    setBusy(false);
    setSession(next);
    setPhase(
      `Waiting for ${pairedDeviceName(route.fingerprint, names)} to accept…`,
    );
  }

  async function decide(accept: boolean) {
    if (!incoming || current.current) return;
    const { id, peer } = incoming;
    const next: Session = { id, direction: 'view', peer };
    const generation = ++epoch.current;
    if (accept) current.current = next;
    setBusy(true);
    const result = await window.lanvory
      .screenSignaling('decide', { id, accept, answer: accept ? format : '' })
      .catch(() => null);
    if (epoch.current !== generation) {
      if (accept && result === true) void end(next);
      return;
    }
    setBusy(false);
    setIncoming(undefined);
    if (result !== true) {
      current.current = undefined;
      setPhase('That invitation is no longer available.');
      return;
    }
    if (accept) {
      setSession(next);
      setPhase(`Viewing ${pairedDeviceName(peer, names)}`);
    } else {
      setPhase('Invitation declined.');
    }
  }

  return (
    <div className="trust-form screen-session">
      {incoming && !session && (
        <div className="screen-invitation">
          <strong>
            {pairedDeviceName(incoming.peer, names)} wants to share their screen
          </strong>
          <div className="pairing-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              Accept
            </button>
            <button
              type="button"
              className="refresh"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {captureActive && !session && !incoming && (
        <>
          <SelectField
            label="Share with"
            name="screenPeer"
            value={target}
            placeholder="Select a paired LAN device"
            disabled={busy}
            onValueChange={setTarget}
            options={choices.map(({ fingerprint }) => ({
              value: fingerprint,
              label: pairedDeviceName(fingerprint, names),
            }))}
          />
          {!choices.length && (
            <p>
              Connect to a paired device over LAN before sending an invitation.
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || !target}
            onClick={() => void invite()}
          >
            Invite to view
          </button>
        </>
      )}
      {phase && <p role="status">{phase}</p>}
      {session && (
        <button
          type="button"
          className="refresh"
          onClick={() => finish('Screen sharing stopped.')}
        >
          End session
        </button>
      )}
      {image && (
        <img
          className="screen-preview-video"
          src={image}
          alt="Shared screen from paired device"
        />
      )}
    </div>
  );
}

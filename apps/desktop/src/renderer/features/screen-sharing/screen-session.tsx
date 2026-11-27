import { useEffect, useRef, useState, type RefObject } from 'react';
import { Unplug } from 'lucide-react';
import { z } from 'zod';
import { SelectField } from '../../components/ui/select';
import { useNotifications } from '../../components/notifications';
import { pairedDeviceName } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';

const format = 'jpeg/1';
const hdFormat = 'jpeg/2';
const uhdFormat = 'jpeg/3';
const frameInterval = 83;
const uhdFrameBytes = 640 * 1024;
const legacyProfiles = [
  { width: 1280, quality: 0.68 },
  { width: 960, quality: 0.62 },
  { width: 640, quality: 0.6 },
  { width: 480, quality: 0.54 },
];
const hdProfiles = [
  { width: 1920, quality: 0.88 },
  { width: 1600, quality: 0.85 },
  { width: 1280, quality: 0.82 },
  { width: 960, quality: 0.76 },
  ...legacyProfiles.slice(1),
];
const qualityModes = {
  [format]: {
    profiles: legacyProfiles,
    maxBytes: 42 * 1024,
    maxHeight: 900,
    slowFrame: 130,
  },
  [hdFormat]: {
    profiles: hdProfiles,
    maxBytes: 160 * 1024,
    maxHeight: 1440,
    slowFrame: 180,
  },
  [uhdFormat]: {
    profiles: [
      { width: 3840, quality: 0.92 },
      { width: 3840, quality: 0.8 },
      { width: 3200, quality: 0.88 },
      { width: 2560, quality: 0.87 },
      ...hdProfiles,
    ],
    maxBytes: uhdFrameBytes,
    maxHeight: 2160,
    slowFrame: 180,
  },
};
type FrameFormat = keyof typeof qualityModes;
const invitation = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  peer: z.string().regex(/^[a-f0-9]{64}$/),
  offer: z.literal(format),
  hd: z.boolean().optional(),
  uhd: z.boolean().optional(),
});
const view = z.object({
  state: z.string(),
  answer: z.string().optional(),
  frame: z
    .string()
    .max(4 * Math.ceil(uhdFrameBytes / 3))
    .optional(),
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

function inviteError(route: PeerRoute, state?: string) {
  if (route.adapter !== 'p2p')
    return 'Could not invite this device. Check its LAN connection and Screen Sharing availability.';
  switch (state) {
    case 'p2p-route-expired':
      return 'The Wi-Fi P2P connection expired. In Devices, choose Bluetooth + Wi-Fi P2P and connect again.';
    case 'peer-not-trusted':
      return 'This device is no longer trusted. Check Paired devices on both Macs.';
    case 'peer-identity-mismatch':
      return 'The device identity could not be verified. Reconnect to the correct device from Devices.';
    case 'peer-invitation-unavailable':
      return 'The other Mac could not accept a new invitation. End any existing Screen Sharing session and try again.';
    case 'p2p-timeout':
      return 'The Wi-Fi P2P connection timed out. Keep both Macs awake and close together, then reconnect in Devices.';
    default:
      return 'Could not reach Screen Sharing over Wi-Fi P2P. Keep Lanvory open and Discoverable enabled on the other Mac, check that both Macs have a build with P2P Screen Sharing, then reconnect.';
  }
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
  frameFormat: FrameFormat,
) {
  if (!video.videoWidth || !video.videoHeight) return undefined;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return undefined;
  const {
    profiles: frameProfiles,
    maxBytes: maxFrameBytes,
    maxHeight,
  } = qualityModes[frameFormat];
  for (let index = level; index < frameProfiles.length; index++) {
    const { width, quality } = frameProfiles[index];
    const ratio = Math.min(
      1,
      width / video.videoWidth,
      maxHeight / video.videoHeight,
    );
    const w = Math.max(1, Math.round(video.videoWidth * ratio));
    const h = Math.max(1, Math.round(video.videoHeight * ratio));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, w, h);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!jpeg || jpeg.size > maxFrameBytes) continue;
    const frame = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result;
        if (
          typeof data === 'string' &&
          data.startsWith('data:image/jpeg;base64,')
        ) {
          resolve(data.slice('data:image/jpeg;base64,'.length));
        } else {
          reject(new Error('Invalid JPEG output'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(jpeg);
    });
    return { frame, level: index };
  }
}

export function ScreenSession({
  video,
  captureActive,
  stopCapture,
  routes,
  names,
  windowVisible,
  onSessionActive,
  error,
  setError,
}: {
  video: RefObject<HTMLVideoElement | null>;
  captureActive: boolean;
  stopCapture(): void;
  routes: Record<string, PeerRoute>;
  names: Record<string, string>;
  windowVisible: boolean;
  onSessionActive(active: boolean): void;
  error: string;
  setError(message: string): void;
}) {
  const { notify } = useNotifications();
  const [target, setTarget] = useState('');
  const [incoming, setIncoming] = useState<Invitation>();
  const [session, setSession] = useState<Session>();
  const [phase, setPhase] = useState('');
  const [image, setImage] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  const hasSession = session !== undefined;
  useEffect(() => {
    onSessionActive(hasSession);
    return () => onSessionActive(false);
  }, [hasSession, onSessionActive]);
  const [busy, setBusy] = useState(false);
  const current = useRef<Session | undefined>(undefined);
  const frameURL = useRef('');
  const epoch = useRef(0);
  const stopCaptureRef = useRef(stopCapture);
  stopCaptureRef.current = stopCapture;
  const choices = Object.values(routes);

  function clearFrame() {
    if (frameURL.current) URL.revokeObjectURL(frameURL.current);
    frameURL.current = '';
  }

  function finish(message: string, toast = false) {
    const old = current.current;
    current.current = undefined;
    epoch.current++;
    if (old) {
      void end(old);
      if (old.direction === 'send') stopCaptureRef.current();
    }
    clearFrame();
    setImage(undefined);
    setSession(undefined);
    setBusy(false);
    setPhase('');
    setError(toast ? '' : message);
    if (toast) notify({ category: 'sharing', tone: 'info', title: message });
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

  useEffect(
    () =>
      window.lanvory.onScreenWindowClosing(() => {
        if (current.current)
          finish(
            'Screen sharing stopped because the Lanvory window was closed.',
            true,
          );
      }),
    [],
  );

  useEffect(
    () =>
      window.lanvory.onStopScreenSharing(() => {
        if (current.current) finish('Screen sharing stopped.', true);
      }),
    [],
  );

  useEffect(() => {
    if (!captureActive && current.current?.direction === 'send')
      finish('Screen capture ended.');
  }, [captureActive]);

  useEffect(() => {
    if (!windowVisible || session || busy) return;
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
  }, [windowVisible, session, busy]);

  useEffect(() => {
    if (!incoming || !windowVisible) return;
    notify({
      category: 'sharing',
      tone: 'info',
      title: 'Screen sharing invitation',
      body: `${pairedDeviceName(incoming.peer, names)} wants to share their screen.`,
      targetPage: 'Screen Sharing',
      actionLabel: 'Review invitation',
      dedupeKey: `screen-sharing:${incoming.id}`,
      toast: false,
      record: true,
    });
  }, [incoming, names, notify, windowVisible]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let sequence = 0;
    let accepted = false;
    let frameFormat: FrameFormat = format;
    let slowFrames = 0;
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
          const encoded = await encodeFrame(
            video.current,
            canvas,
            level,
            frameFormat,
          ).catch(() => undefined);
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
            reply.success && reply.data.state === 'declined',
          );
          return;
        }
        if (!accepted && reply.data.state === 'accepted') {
          if (
            reply.data.answer !== format &&
            reply.data.answer !== hdFormat &&
            reply.data.answer !== uhdFormat
          ) {
            finish('This device does not support the screen-sharing format.');
            return;
          }
          frameFormat = reply.data.answer;
          accepted = true;
          setPhase('');
          notify({
            category: 'sharing',
            tone: 'success',
            title: 'Sharing your screen',
          });
        }
        if (accepted) {
          const elapsed = performance.now() - start;
          const mode = qualityModes[frameFormat];
          if (elapsed > mode.slowFrame) {
            fastFrames = 0;
            if (++slowFrames >= 3) {
              level = Math.min(level + 1, mode.profiles.length - 1);
              slowFrames = 0;
            }
          } else {
            slowFrames = 0;
            if (level > 0 && elapsed < frameInterval) {
              if (++fastFrames >= 24) {
                level--;
                fastFrames = 0;
              }
            } else {
              fastFrames = 0;
            }
          }
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
          (!reply.data.frame && Date.now() - lastFrame > 8000)
        ) {
          finish(
            'The screen-sharing session ended or the connection was lost.',
          );
          return;
        }
        const { frame, sequence: next } = reply.data;
        if (!frame && Date.now() - lastFrame > 3000 && frameURL.current) {
          clearFrame();
          setImage(undefined);
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
            setImage({
              url,
              width: nextImage.naturalWidth,
              height: nextImage.naturalHeight,
            });
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
    if (!captureActive || !route || current.current) return;
    const id = crypto.randomUUID().replaceAll('-', '');
    const next: Session = { id, direction: 'send', route };
    current.current = next;
    const generation = ++epoch.current;
    setError('');
    setBusy(true);
    const reply = view.safeParse(
      await tell(route, {
        action: 'offer',
        hd: true,
        uhd: true,
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
      finish(inviteError(route, reply.data?.state));
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
    setError('');
    setBusy(true);
    const result = await window.lanvory
      .screenSignaling('decide', {
        id,
        accept,
        answer: accept
          ? incoming.uhd
            ? uhdFormat
            : incoming.hd
              ? hdFormat
              : format
          : '',
      })
      .catch(() => null);
    if (epoch.current !== generation) {
      if (accept && result === true) void end(next);
      return;
    }
    setBusy(false);
    setIncoming(undefined);
    if (result !== true) {
      current.current = undefined;
      setError('That invitation is no longer available.');
      return;
    }
    if (accept) {
      setSession(next);
      setPhase(`Viewing ${pairedDeviceName(peer, names)}`);
    } else {
      setPhase('');
      notify({
        category: 'sharing',
        tone: 'info',
        title: 'Invitation declined.',
      });
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
            placeholder="Select a paired device"
            disabled={busy}
            onValueChange={setTarget}
            options={choices.map(({ fingerprint }) => ({
              value: fingerprint,
              label: pairedDeviceName(fingerprint, names),
            }))}
          />
          {!choices.length && (
            <p>
              Connect to a paired device over LAN or Bluetooth + Wi-Fi P2P
              before sending an invitation.
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || !routes[target]}
            onClick={() => void invite()}
          >
            Invite to view
          </button>
        </>
      )}
      {(error || phase) && <p role="status">{error || phase}</p>}
      {session && (
        <button
          type="button"
          className="screen-stop-action screen-end-session"
          onClick={() => finish('Screen sharing stopped.', true)}
        >
          <Unplug size={17} aria-hidden="true" />
          End session
        </button>
      )}
      {image && (
        <div className="screen-viewer">
          <div className="screen-viewer-toolbar">
            <span>
              {image.width} × {image.height}
            </span>
            {session?.direction === 'view' && (
              <button
                type="button"
                className="screen-viewer-open"
                onClick={() => {
                  void window.lanvory
                    .openScreenViewer(session.id)
                    .then((opened) => {
                      if (!opened)
                        notify({
                          category: 'sharing',
                          tone: 'error',
                          title: 'Could not open the screen viewer.',
                        });
                    })
                    .catch(() =>
                      notify({
                        category: 'sharing',
                        tone: 'error',
                        title: 'Could not open the screen viewer.',
                      }),
                    );
                }}
              >
                Open viewer
              </button>
            )}
          </div>
          <div
            className="screen-viewer-image"
            role="region"
            aria-label="Shared screen viewport"
          >
            <img
              src={image.url}
              width={image.width}
              height={image.height}
              alt="Shared screen from paired device"
            />
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AppWindow, Monitor, RefreshCw, ScanLine, Square } from 'lucide-react';
import { PanelHeading } from '../../components/panel-heading';
import type { ScreenSource } from '../../../shared/desktop-api';
import { ScreenSession } from './screen-session';
import type { PeerRoute } from '../sharing/sharing';
import './screen-sharing.css';

function SourceThumbnail({ source }: { source: ScreenSource }) {
  const [url, setUrl] = useState<string>();
  const thumbnail = source.thumbnail;

  useEffect(() => {
    if (!thumbnail) {
      setUrl(undefined);
      return;
    }
    const preview = URL.createObjectURL(
      new Blob([Uint8Array.from(thumbnail)], { type: 'image/png' }),
    );
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [thumbnail]);

  const Icon = source.kind === 'display' ? Monitor : AppWindow;
  return (
    <span className="screen-source-thumbnail" aria-hidden="true">
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <Icon size={28} />
      )}
    </span>
  );
}

export function ScreenPreview({
  routes,
  names,
  windowVisible,
  onSessionActive,
}: {
  routes: Record<string, PeerRoute>;
  names: Record<string, string>;
  windowVisible: boolean;
  onSessionActive(active: boolean): void;
}) {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [selection, setSelection] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sessionError, setSessionError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);

  function release() {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    void window.lanvory.releaseScreenPreview().catch(() => {});
  }

  useEffect(() => release, []);

  function stop() {
    release();
    setActive(false);
    setBusy(false);
  }

  useEffect(() => window.lanvory.onScreenWindowClosing(stop), []);

  async function findSources() {
    setBusy(true);
    setMessage('');
    setSessionError('');
    setSelection('');
    const request = ++generation.current;
    try {
      const result = await window.lanvory.screenPreviewSources();
      if (request !== generation.current) return;
      if (result.status !== 'ready') setSources([]);
      if (result.status === 'ready') {
        setSources(result.sources);
      } else if (result.status === 'restricted') {
        setMessage('Screen recording is restricted on this Mac.');
      } else if (
        result.status === 'denied' ||
        result.status === 'not-determined'
      ) {
        const opened = await window.lanvory
          .openScreenRecordingSettings()
          .catch(() => false);
        if (request !== generation.current) return;
        setMessage(
          opened
            ? 'Allow Screen Recording in System Settings, then reopen Lanvory and try again.'
            : 'Open System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Lanvory.',
        );
      } else {
        setMessage(
          'No screen sources are available. Open a window and try again.',
        );
      }
    } catch {
      if (request === generation.current) {
        setSources([]);
        setMessage('Could not read screen sources. Try again.');
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setMessage('');
    const request = ++generation.current;
    try {
      if (!(await window.lanvory.selectScreenPreviewSource(selection)))
        throw new Error('Source unavailable');
      if (request !== generation.current) return;
      const capture = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 3840, max: 3840 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (request !== generation.current || !video.current) {
        capture.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = capture;
      video.current.srcObject = capture;
      capture.getVideoTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (stream.current !== capture) return;
          stop();
          setMessage('The screen source was closed or stopped.');
        },
        { once: true },
      );
      setActive(true);
    } catch {
      void window.lanvory.releaseScreenPreview().catch(() => {});
      if (request === generation.current)
        setMessage(
          'Preview was cancelled or could not start. Check Screen Recording permissions if this persists.',
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  return (
    <section
      className="network-panel operation-card screen-preview-panel"
      aria-labelledby="screen-preview-heading"
    >
      <PanelHeading
        icon={Monitor}
        id="screen-preview-heading"
        title="Screen sharing"
        description="Share a window or display with a paired device over your local network."
      />
      <div className="trust-form">
        {!active && sources.length === 0 && (
          <button
            type="button"
            className="primary screen-source-find"
            disabled={busy}
            onClick={() => void findSources()}
          >
            <ScanLine size={17} aria-hidden="true" />
            {busy ? 'Finding sources…' : 'Find windows and displays'}
          </button>
        )}
        {sources.length > 0 && !active && (
          <div className="screen-source-browser" aria-busy={busy && !selection}>
            <div className="screen-source-toolbar">
              <h3 id="screen-source-heading">Choose what to share</h3>
              <button
                type="button"
                className="screen-source-refresh"
                disabled={busy}
                onClick={() => void findSources()}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {busy && !selection ? 'Refreshing…' : 'Refresh sources'}
              </button>
            </div>
            <fieldset
              className="screen-source-picker"
              aria-labelledby="screen-source-heading"
              disabled={busy}
            >
              {(
                [
                  { kind: 'display', title: 'Displays' },
                  { kind: 'window', title: 'Windows' },
                ] as const
              ).map(({ kind, title }) => {
                const group = sources.filter((source) => source.kind === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind} className="screen-source-group">
                    <h4>{title}</h4>
                    <div className="screen-source-grid">
                      {group.map((source) => (
                        <label className="screen-source-tile" key={source.id}>
                          <input
                            type="radio"
                            name="screenSource"
                            value={source.id}
                            checked={selection === source.id}
                            onChange={() => setSelection(source.id)}
                          />
                          <SourceThumbnail source={source} />
                          <span
                            className="screen-source-name"
                            title={source.name}
                          >
                            {source.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </div>
        )}
        {active ? (
          <button
            type="button"
            className="screen-stop-action screen-stop-preview"
            onClick={stop}
          >
            <Square size={16} aria-hidden="true" />
            Stop preview
          </button>
        ) : selection ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            Start local preview
          </button>
        ) : null}
      </div>
      <video
        className="screen-preview-video"
        ref={video}
        hidden={!active}
        autoPlay
        muted
        playsInline
        aria-label="Local screen preview"
      />
      {message && <p role="status">{message}</p>}
      <ScreenSession
        error={sessionError}
        setError={setSessionError}
        video={video}
        captureActive={active}
        stopCapture={stop}
        routes={routes}
        names={names}
        windowVisible={windowVisible}
        onSessionActive={onSessionActive}
      />
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { Services } from '../features/services/services';
import { Sharing, type PeerRoute } from '../features/sharing/sharing';
import { ScreenPreview } from '../features/screen-sharing/screen-preview';
import { readPairedNames } from '../services/paired-names';
import type { PairingTarget } from '../features/devices/nearby';
import { SettingsPanel, type TextSize, type Theme, type Density } from '../features/settings/settings';
import { NetworkPanel } from '../features/network/network';
import { SyncPanel } from '../features/sync/sync';
import { MountsPanel } from '../features/mounts/mounts';
import { Workspace, type Page } from '../layouts/workspace';
import { CommandPalette, type PaletteCommand } from '../components/command-palette';
import { NotificationsProvider, useNotifications } from '../components/notifications';
import { DevicesPage } from '../pages/devices';
import { identitySchema, readIdentity, type IdentityResponse } from '../services/identity';
import '../styles/app.css';

const savedRoutesSchema = z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  adapter: z.string().regex(/^[a-zA-Z0-9_.-]{1,32}$/),
  endpoint: z.string().max(21),
  label: z.string().max(64).optional(),
}));

function readPeerRoutes(owner: string): Record<string, PeerRoute> {
  try {
    const parsed = savedRoutesSchema.safeParse(JSON.parse(localStorage.getItem(`lanvory.peer-routes.${owner}`) ?? '{}')).data ?? {};
    return Object.fromEntries(Object.entries(parsed).filter(([, route]) => route.adapter !== 'p2p'));
  } catch {
    return {};
  }
}

const textSizeKey = 'lanvory.text-size';
const densityKey = 'lanvory.density';
const reducedMotionKey = 'lanvory.reduced-motion';
const themeKey = 'lanvory.theme';

function readTextSize(): TextSize {
  try {
    return localStorage.getItem(textSizeKey) === 'large' ? 'large' : 'default';
  } catch {
    return 'default';
  }
}

function readDensity(): Density {
  try {
    return localStorage.getItem(densityKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(themeKey);
    return value === 'light' || value === 'system' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

function readReducedMotion() {
  try {
    return localStorage.getItem(reducedMotionKey) === 'true';
  } catch {
    return false;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const trustedRows = z.array(z.object({ fingerprint: z.string() }));
const serviceRows = z.object({ services: z.array(z.unknown()) });
const incomingRows = z.object({
  offers: z.array(z.object({ id: z.string(), name: z.string(), size: z.number().nonnegative() }).passthrough()),
  transfers: z.array(z.object({ id: z.string(), name: z.string(), state: z.string(), direction: z.string() }).passthrough()).optional(),
});
const transferRows = z.object({ transfers: z.array(z.object({ state: z.string() })) });
const pairingRows = z.array(z.object({ id: z.string(), direction: z.string() }).passthrough());
const clipboardRow = z.object({
  enabled: z.boolean(),
  latest: z.object({ sha256: z.string(), text: z.string() }).optional(),
});
const listenerRow = z.object({ state: z.literal('listening'), pairing: z.boolean().optional() });

function formatBytesShort(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function App() {
  const [page, setPage] = useState<Page>('Devices');
  const [openedSharing, setOpenedSharing] = useState(false);

  function navigate(next: Page) {
    if (next === 'Sharing') setOpenedSharing(true);
    setPage(next);
  }

  return (
    <NotificationsProvider onNavigate={navigate}>
      <AppContent page={page} openedSharing={openedSharing} navigate={navigate} />
    </NotificationsProvider>
  );
}

function AppContent({
  page,
  openedSharing,
  navigate,
}: {
  page: Page;
  openedSharing: boolean;
  navigate(next: Page): void;
}) {
  const { notify } = useNotifications();
  const seededTransfers = useRef<Set<string> | null>(null);
  const [textSize, setTextSize] = useState(readTextSize);
  const [theme, setTheme] = useState(readTheme);
  const [density, setDensity] = useState(readDensity);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  function changeReducedMotion(enabled: boolean) {
    setReducedMotion(enabled);
    return savePreference(reducedMotionKey, String(enabled));
  }

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  function changeDensity(next: Density) {
    setDensity(next);
    return savePreference(densityKey, next);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function changeTheme(next: Theme) {
    setTheme(next);
    return savePreference(themeKey, next);
  }

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
  }, [textSize]);

  function changeTextSize(size: TextSize) {
    setTextSize(size);
    return savePreference(textSizeKey, size);
  }

  const [response, setResponse] = useState<IdentityResponse>();
  const identityRevision = useRef(0);
  const [retrying, setRetrying] = useState(false);
  const identity = response?.device;
  const [screenSessionActive, setScreenSessionActive] = useState(false);

  useEffect(() => {
    void window.lanvory.setScreenSessionActive(screenSessionActive).catch(() => {});
  }, [screenSessionActive]);
  const [screenSharingAvailable, setScreenSharingAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void window.lanvory.screenPreviewAvailable().then((available) => {
      if (active) setScreenSharingAvailable(available);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const [windowVisible, setWindowVisible] = useState(() => !document.hidden);
  const [routeState, setRouteState] = useState<{ owner: string; routes: Record<string, PeerRoute> }>();
  const savedRoutes = useMemo(() => identity?.id ? readPeerRoutes(identity.id) : {}, [identity?.id]);
  const peerRoutes = routeState?.owner === identity?.id && routeState ? routeState.routes : savedRoutes;

  function rememberRoute(peer: PeerRoute) {
    if (!identity) return;
    const routes = { ...peerRoutes, [peer.fingerprint]: { ...peerRoutes[peer.fingerprint], ...peer } };
    setRouteState({ owner: identity.id, routes });
    try {
      const persisted = Object.fromEntries(Object.entries(routes).filter(([, route]) => route.adapter !== 'p2p'));
      localStorage.setItem(`lanvory.peer-routes.${identity.id}`, JSON.stringify(persisted));
    } catch {
      // The verified route remains available for this session.
    }
  }

  function clearP2PRoute(fingerprint: string) {
    if (!identity) return;
    const fallback = savedRoutes[fingerprint];
    const next = { ...peerRoutes };
    if (fallback && fallback.adapter !== 'p2p') {
      next[fingerprint] = fallback;
    } else {
      delete next[fingerprint];
    }
    setRouteState({ owner: identity.id, routes: next });
  }
  const [pairingTarget, setPairingTarget] = useState<{ revision: number; target?: PairingTarget }>({ revision: 0 });
  const [trustRevision, setTrustRevision] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setPaletteOpen((open) => !open);
        } else if (event.key === '1') {
          event.preventDefault();
          navigate('Devices');
        } else if (event.key === '2') {
          event.preventDefault();
          navigate('Sharing');
        } else if (event.key === '3') {
          event.preventDefault();
          navigate('Services');
        } else if (event.key === '4') {
          event.preventDefault();
          navigate('Network');
        } else if (event.key === '5') {
          event.preventDefault();
          navigate('Settings');
        } else if (event.key === '6') {
          event.preventDefault();
          navigate('Sync');
        } else if (event.key === '7') {
          event.preventDefault();
          navigate('Live Resources');
        }
      } else if (event.key === 'Escape') {
        if (paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
        } else if (pairingTarget.target) {
          event.preventDefault();
          setPairingTarget(({ revision }) => ({ revision: revision + 1 }));
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pairingTarget.target, paletteOpen]);

  useEffect(() => {
    const update = () => setWindowVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => window.lanvory.onNavigate?.((target) => {
    navigate(target);
  }), [navigate]);

  useEffect(() => {
    if (!windowVisible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const revision = identityRevision.current;
      const result = await readIdentity();
      if (!active) return;
      if (revision === identityRevision.current) setResponse(result);
      timer = setTimeout(refresh, 4000);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [windowVisible]);

  async function retry() {
    setRetrying(true);
    const result = await readIdentity(true);
    identityRevision.current += 1;
    setResponse(result);
    setRetrying(false);
  }

  const [scanRevision, setScanRevision] = useState(0);
  const [nearbyCount, setNearbyCount] = useState<number>();
  const [listener, setListener] = useState<z.infer<typeof listenerRow>>();
  const lanActive = listener !== undefined;
  const [bleState, setBleState] = useState<{ ready: boolean; active: boolean }>({ ready: false, active: false });
  const [pendingFiles, setPendingFiles] = useState(0);
  const [counts, setCounts] = useState<{ trusted?: number; services?: number; transfers?: number }>({});


  useEffect(() => {
    if (!windowVisible || !identity) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const listenerStatus = await window.lanvory.listenerStatus().catch(() => null);
      if (!active) return;
      setListener(listenerRow.safeParse(listenerStatus).data);
      const fileActivity = page === 'Sharing'
        ? undefined : window.lanvory.fileSnapshot().catch(() => null);
      const [pairingList, clipboardInfo, nearbyInfo] = await Promise.all([
        window.lanvory.pairingRequests().catch(() => null),
        window.lanvory.clipboardState().catch(() => null),
        window.lanvory.nearbyStatus().catch(() => null),
      ]);
      if (!active) return;

      const parsedNearby = z.object({
        status: z.object({
          bluetoothState: z.string(),
          advertising: z.boolean(),
        }),
      }).safeParse(nearbyInfo);
      if (parsedNearby.success) {
        setBleState({
          ready: parsedNearby.data.status.bluetoothState === 'poweredOn',
          active: parsedNearby.data.status.advertising,
        });
      }

      const parsedPairing = pairingRows.safeParse(pairingList);
      if (parsedPairing.success) {
        for (const req of parsedPairing.data) {
          if (req.direction === 'incoming') {
            notify({
              category: 'pairing',
              tone: 'warning',
              title: 'Incoming pairing request',
              body: 'Compare the verification code on both devices to pair.',
              targetPage: 'Devices',
              actionLabel: 'Review pairing',
              dedupeKey: `pairing:${req.id}`,
              toast: false,
              record: true,
            });
          }
        }
      }

      const parsedClipboard = clipboardRow.safeParse(clipboardInfo);
      if (parsedClipboard.success && parsedClipboard.data.enabled && parsedClipboard.data.latest) {
        const snippet = parsedClipboard.data.latest;
        notify({
          category: 'clipboard',
          tone: 'info',
          title: 'Shared clipboard updated',
          body: snippet.text.length > 60 ? `${snippet.text.slice(0, 60)}…` : snippet.text,
          targetPage: 'Sharing',
          actionLabel: 'Open Sharing',
          dedupeKey: `clipboard:${snippet.sha256}`,
          toast: false,
          record: true,
        });
      }

      if (page === 'Devices') {
        const [trust, services, activity] = await Promise.all([
          window.lanvory.trustedPeers().catch(() => null),
          window.lanvory.serviceSnapshot().catch(() => null),
          fileActivity,
        ]);
        if (!active) return;
        setCounts({
          trusted: trustedRows.safeParse(trust).data?.length,
          services: serviceRows.safeParse(services).data?.services.length,
          transfers: transferRows.safeParse(activity).data?.transfers.filter((item) => item.state === 'streaming' || item.state === 'waiting').length,
        });
      }
      if (fileActivity) {
        const incoming = incomingRows.safeParse(await fileActivity);
        if (!active) return;
        const offers = incoming.data?.offers ?? [];
        setPendingFiles(offers.length);
        for (const offer of offers) {
          notify({
            category: 'sharing',
            tone: 'info',
            title: `File request: ${offer.name}`,
            body: `${formatBytesShort(offer.size)} waiting for your approval.`,
            targetPage: 'Sharing',
            actionLabel: 'Review file',
            dedupeKey: `offer:${offer.id}`,
            toast: false,
            record: true,
          });
        }
        const transfers = incoming.data?.transfers ?? [];
        if (seededTransfers.current === null) {
          seededTransfers.current = new Set(
            transfers
              .filter((item) => item.state === 'completed' || item.state === 'failed')
              .map((item) => `${item.id}:${item.state}`),
          );
        } else {
          for (const item of transfers) {
            if (item.state === 'completed' || item.state === 'failed') {
              const key = `${item.id}:${item.state}`;
              if (!seededTransfers.current.has(key)) {
                seededTransfers.current.add(key);
                notify({
                  category: 'sharing',
                  tone: item.state === 'completed' ? 'success' : 'error',
                  title: item.state === 'completed' ? `Transfer completed: ${item.name}` : `Transfer failed: ${item.name}`,
                  targetPage: 'Sharing',
                  actionLabel: 'View history',
                  dedupeKey: `transfer:${key}`,
                  record: true,
                });
              }
            }
          }
        }
      }
      timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [windowVisible, identity?.id, page, trustRevision, notify]);

  function discover() {
    setScanRevision((value) => value + 1);
    document.getElementById('nearby-title')?.focus();
  }

  const status = identity ? (lanActive ? 'Ready to connect' : 'App ready')
    : response?.startupFailed ? 'Could not start Lanvory'
    : response?.startupSlow ? 'Taking longer to start…'
    : response === undefined || response.startupPending ? 'Starting Lanvory…'
    : 'Lanvory unavailable';
  function findDeviceToPair() {
    navigate('Devices');
    setScanRevision((value) => value + 1);
  }

  return (
    <Workspace page={page} status={status} online={Boolean(identity)} lanActive={Boolean(identity) && lanActive}
      bleActive={Boolean(identity) && bleState.active}
      bleReady={Boolean(identity) && bleState.ready}
      onNavigate={navigate}
      onOpenPalette={() => setPaletteOpen(true)}
      pendingFiles={identity ? pendingFiles : 0}
      screenSharingAvailable={screenSharingAvailable}
      screenSessionActive={screenSessionActive}
    >
        {page === 'Settings' ? (
          <SettingsPanel ownerId={identity?.id} fingerprint={identity?.fingerprint} reducedMotion={reducedMotion} onReducedMotionChange={changeReducedMotion} density={density} onDensityChange={changeDensity} theme={theme} onThemeChange={changeTheme} textSize={textSize} onTextSizeChange={changeTextSize} name={identity?.name} protocolVersion={identity?.protocolVersion} daemonVersion={identity?.daemonVersion} onRename={async (name) => {
            const result = identitySchema.safeParse(await window.lanvory.renameDevice(name).catch(() => null));
            if (!result.success) return false;
            identityRevision.current++;
            setResponse({ device: result.data });
            return true;
          }} />
        ) : page === 'Network' ? <NetworkPanel visible={windowVisible} deviceName={identity?.name} routes={peerRoutes} onRoute={rememberRoute} /> : page === 'Sync' ? <SyncPanel visible={windowVisible} ownerId={identity?.id} routes={peerRoutes} onRoute={rememberRoute} /> : page === 'Live Resources' ? <MountsPanel visible={windowVisible} ownerId={identity?.id} routes={peerRoutes} onRoute={rememberRoute} /> : page === 'Services' ? <Services key={identity?.id} ownerId={identity?.id} visible={windowVisible} routes={peerRoutes} onPair={findDeviceToPair} onRoute={rememberRoute} /> : page === 'Sharing' || page === 'Screen Sharing' ? null : (
          <DevicesPage incomingPairingEnabled={listener?.pairing === true} response={response} retrying={retrying} visible={windowVisible} scanRevision={scanRevision}
            nearbyCount={nearbyCount} counts={counts} trustRevision={trustRevision} pairingTarget={pairingTarget} routes={peerRoutes}
            onDiscover={discover} onShare={() => navigate('Sharing')} onServices={() => navigate('Services')} onNetwork={() => navigate('Network')} onRetry={() => void retry()}
            onCount={setNearbyCount} onSelectPeer={(target) => setPairingTarget(({ revision }) => ({ revision: revision + 1, target }))}
            onClearTarget={() => setPairingTarget(({ revision }) => ({ revision: revision + 1 }))}
            onPaired={rememberRoute}
            onTrustChange={() => setTrustRevision((value) => value + 1)} />
        )}
        {openedSharing && <div hidden={page !== 'Sharing'}><Sharing ownerId={identity?.id} onPendingFilesChange={setPendingFiles} visible={windowVisible && page === 'Sharing'} routes={peerRoutes} onPair={findDeviceToPair} onRoute={rememberRoute} onClearP2PRoute={clearP2PRoute} /></div>}
        {screenSharingAvailable && (
          <div className="screen-sharing-page" data-background={page !== 'Screen Sharing'}
            inert={page !== 'Screen Sharing'}>
            <ScreenPreview key={identity?.id} routes={peerRoutes} windowVisible={windowVisible}
              names={identity ? readPairedNames(identity.id) : {}} onSessionActive={setScreenSessionActive} />
          </div>
        )}
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={[
            { id: 'nav-devices', category: 'Navigate', label: 'Go to Devices', shortcut: '⌘1', run: () => navigate('Devices') },
            { id: 'nav-sharing', category: 'Navigate', label: 'Go to Sharing', shortcut: '⌘2', run: () => navigate('Sharing') },
            ...(screenSharingAvailable ? [{ id: 'nav-screen-sharing', category: 'Navigate', label: 'Go to Screen Sharing', run: () => navigate('Screen Sharing') }] : []),
            { id: 'nav-sync', category: 'Navigate', label: 'Go to Sync', shortcut: '⌘6', run: () => navigate('Sync') },
            { id: 'nav-mounts', category: 'Navigate', label: 'Go to Live Resources', shortcut: '⌘7', run: () => navigate('Live Resources') },
            { id: 'nav-services', category: 'Navigate', label: 'Go to Services', shortcut: '⌘3', run: () => navigate('Services') },
            { id: 'nav-network', category: 'Navigate', label: 'Go to Network', shortcut: '⌘4', run: () => navigate('Network') },
            { id: 'nav-settings', category: 'Navigate', label: 'Go to Settings', shortcut: '⌘5', run: () => navigate('Settings') },
            { id: 'act-scan', category: 'Devices', label: 'Scan nearby devices', disabled: !identity, run: findDeviceToPair },
            { id: 'act-inbox', category: 'Sharing', label: 'Open file inbox folder', run: () => { void window.lanvory.openInbox(); } },
            { id: 'act-fp', category: 'Identity', label: 'Copy local device ID', disabled: !identity, run: () => { if (identity) void window.lanvory.copyFingerprint(identity.fingerprint); } },
            { id: 'act-diag', category: 'Network', label: 'Copy network diagnostic report', run: () => { void window.lanvory.copyNetworkReport(); } },
            { id: 'act-theme', category: 'Appearance', label: `Switch theme (current: ${theme})`, run: () => { void changeTheme(theme === 'dark' ? 'light' : 'dark'); } },
          ] satisfies PaletteCommand[]}
        />
    </Workspace>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { Services } from '../features/services/services';
import { Sharing, type PeerRoute } from '../features/sharing/sharing';
import type { PairingTarget } from '../features/devices/nearby';
import { SettingsPanel, type TextSize, type Theme, type Density } from '../features/settings/settings';
import { NetworkPanel } from '../features/network/network';
import { Workspace, type Page } from '../layouts/workspace';
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
    return savedRoutesSchema.safeParse(JSON.parse(localStorage.getItem(`lanvory.peer-routes.${owner}`) ?? '{}')).data ?? {};
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
const incomingRows = z.object({ offers: z.array(z.unknown()) });
const transferRows = z.object({ transfers: z.array(z.object({ state: z.string() })) });
const listenerRow = z.object({ state: z.literal('listening'), pairing: z.boolean().optional() });

function App() {
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
  const [windowVisible, setWindowVisible] = useState(() => !document.hidden);
  const [routeState, setRouteState] = useState<{ owner: string; routes: Record<string, PeerRoute> }>();
  const savedRoutes = useMemo(() => identity?.id ? readPeerRoutes(identity.id) : {}, [identity?.id]);
  const peerRoutes = routeState?.owner === identity?.id && routeState ? routeState.routes : savedRoutes;

  function rememberRoute(peer: PeerRoute) {
    if (!identity) return;
    const routes = { ...peerRoutes, [peer.fingerprint]: { ...peerRoutes[peer.fingerprint], ...peer } };
    setRouteState({ owner: identity.id, routes });
    try {
      localStorage.setItem(`lanvory.peer-routes.${identity.id}`, JSON.stringify(routes));
    } catch {
      // The verified route remains available for this session.
    }
  }
  const [pairingTarget, setPairingTarget] = useState<{ revision: number; target?: PairingTarget }>({ revision: 0 });
  const [trustRevision, setTrustRevision] = useState(0);
  const [openedSharing, setOpenedSharing] = useState(false);
  const [page, setPage] = useState<Page>('Devices');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key === '1') {
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
        }
      } else if (event.key === 'Escape') {
        if (pairingTarget.target) {
          event.preventDefault();
          setPairingTarget(({ revision }) => ({ revision: revision + 1 }));
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pairingTarget.target]);

  useEffect(() => {
    const update = () => setWindowVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

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
        setPendingFiles(incoming.data?.offers.length ?? 0);
      }
      timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [windowVisible, identity?.id, page, trustRevision]);

  function navigate(next: Page) {
    if (next === 'Sharing') setOpenedSharing(true);
    setPage(next);
  }

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
    setPage('Devices');
    setScanRevision((value) => value + 1);
  }

  return (
    <Workspace page={page} status={status} online={Boolean(identity)} lanActive={Boolean(identity) && lanActive}
      onNavigate={navigate}
      pendingFiles={identity ? pendingFiles : 0}
      action={page === 'Devices' && <div className="page-heading-actions">
        <button type="button" className="primary" disabled={!identity} onClick={discover}>
          <Plus size={18} aria-hidden="true" /> Pair Device
        </button>
      </div>}
    >
        {page === 'Settings' ? (
          <SettingsPanel ownerId={identity?.id} fingerprint={identity?.fingerprint} reducedMotion={reducedMotion} onReducedMotionChange={changeReducedMotion} density={density} onDensityChange={changeDensity} theme={theme} onThemeChange={changeTheme} textSize={textSize} onTextSizeChange={changeTextSize} name={identity?.name} protocolVersion={identity?.protocolVersion} daemonVersion={identity?.daemonVersion} onRename={async (name) => {
            const result = identitySchema.safeParse(await window.lanvory.renameDevice(name).catch(() => null));
            if (!result.success) return false;
            identityRevision.current++;
            setResponse({ device: result.data });
            return true;
          }} />
        ) : page === 'Network' ? <NetworkPanel visible={windowVisible} /> : page === 'Services' ? <Services key={identity?.id} ownerId={identity?.id} visible={windowVisible} routes={peerRoutes} onPair={findDeviceToPair} onRoute={rememberRoute} /> : page === 'Sharing' ? null : (
          <DevicesPage incomingPairingEnabled={listener?.pairing === true} response={response} retrying={retrying} visible={windowVisible} scanRevision={scanRevision}
            nearbyCount={nearbyCount} counts={counts} trustRevision={trustRevision} pairingTarget={pairingTarget}
            onDiscover={discover} onShare={() => navigate('Sharing')} onServices={() => navigate('Services')} onNetwork={() => navigate('Network')} onRetry={() => void retry()}
            onCount={setNearbyCount} onSelectPeer={(target) => setPairingTarget(({ revision }) => ({ revision: revision + 1, target }))}
            onClearTarget={() => setPairingTarget(({ revision }) => ({ revision: revision + 1 }))}
            onPaired={rememberRoute}
            onTrustChange={() => setTrustRevision((value) => value + 1)} />
        )}
        {openedSharing && <div hidden={page !== 'Sharing'}><Sharing ownerId={identity?.id} onPendingFilesChange={setPendingFiles} visible={windowVisible && page === 'Sharing'} routes={peerRoutes} onPair={findDeviceToPair} onRoute={rememberRoute} /></div>}
    </Workspace>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

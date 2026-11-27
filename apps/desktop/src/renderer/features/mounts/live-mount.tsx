import { type FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bluetooth,
  Check,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Eye,
  File as FileIcon,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Info,
  Laptop,
  Layers,
  MoreHorizontal,
  Music,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { connectionError, lanSuggestedEndpoint, PeerConnectionFields } from '../../components/peer-connection-fields';
import { PanelHeading } from '../../components/panel-heading';
import { SelectField } from '../../components/ui/select';
import { useNotifications } from '../../components/notifications';
import { pairedDeviceName } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';

export const mountExportSchema = z.object({
  id: z.string(),
  path: z.string(),
  readOnly: z.boolean(),
});

export const mountRecordSchema = z.object({
  id: z.string(),
  peerName: z.string(),
  fingerprint: z.string(),
  interface: z.string(),
  endpoint: z.string(),
  remoteId: z.string(),
  url: z.string(),
  state: z.string().optional(),
  mountPoint: z.string().optional(),
  mounted: z.boolean(),
  mountError: z.string().optional(),
  startedAt: z.string(),
});

const resourceDescriptorSchema = z.object({
  id: z.string(),
  readOnly: z.boolean(),
  fileCount: z.number(),
  totalBytes: z.number(),
  updatedAt: z.string(),
});

const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDir: z.boolean(),
  size: z.number(),
  modifiedAt: z.string().optional(),
  etag: z.string().optional(),
  contentType: z.string().optional(),
});

const streamChunkSchema = z.object({
  offset: z.number(),
  length: z.number(),
  totalSize: z.number(),
  etag: z.string(),
  fromCache: z.boolean(),
  isText: z.boolean(),
  dataBase64: z.string(),
  text: z.string().optional(),
});

const eventSchema = z.object({
  seq: z.number(),
  type: z.string(),
  resourceId: z.string(),
  path: z.string().optional(),
  oldPath: z.string().optional(),
  timestamp: z.string(),
});

export type MountExport = z.infer<typeof mountExportSchema>;
export type MountRecord = z.infer<typeof mountRecordSchema>;
type ResourceDescriptor = z.infer<typeof resourceDescriptorSchema>;
type WebDAVEntry = z.infer<typeof entrySchema>;
type StreamChunk = z.infer<typeof streamChunkSchema>;
type ResourceEvent = z.infer<typeof eventSchema>;

type MountGrant = {
  fingerprint: string;
  capability: string;
  resource: string;
  inactive?: boolean;
};

type MountFeedback = { tone: 'success' | 'info' | 'error'; text: string } | null;

function MountBanner({ feedback }: { feedback: MountFeedback }) {
  if (!feedback) return null;
  const Icon = feedback.tone === 'success' ? CheckCircle2 : feedback.tone === 'error' ? AlertCircle : Info;
  return (
    <div className={`sync-feedback-banner is-${feedback.tone}`} role="status">
      <Icon size={15} aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function suggestFolderId(folderPath: string) {
  const base = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-_]+$/g, '')
    .slice(0, 48);
}

function extOf(name: string) {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function isVideo(name: string) {
  return ['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(extOf(name));
}

function isAudio(name: string) {
  return ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(extOf(name));
}

function isImage(name: string) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extOf(name));
}

function isTextLike(name: string) {
  return ['txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'go', 'py', 'css', 'html', 'yml', 'yaml', 'log', 'csv', 'xml'].includes(extOf(name));
}

function EntryIcon({ entry }: { entry: WebDAVEntry }) {
  if (entry.isDir) return <Folder size={16} aria-hidden="true" />;
  if (isVideo(entry.name)) return <Film size={16} aria-hidden="true" />;
  if (isAudio(entry.name)) return <Music size={16} aria-hidden="true" />;
  if (isImage(entry.name)) return <ImageIcon size={16} aria-hidden="true" />;
  if (isTextLike(entry.name)) return <FileText size={16} aria-hidden="true" />;
  return <FileIcon size={16} aria-hidden="true" />;
}

function friendlyEventText(ev: ResourceEvent) {
  const name = ev.path && ev.path !== '/' ? ev.path : ev.resourceId;
  switch (ev.type) {
    case 'file.created': return `Added ${name}`;
    case 'file.modified': return `Updated ${name}`;
    case 'file.deleted': return `Removed ${name}`;
    case 'file.renamed': return `Renamed ${name}`;
    case 'permission.revoked': return `Access revoked for ${ev.resourceId}`;
    case 'resource.created': return `Connected to ${ev.resourceId}`;
    default: return `${ev.type} · ${name}`;
  }
}

export function LiveMountSection({
  mode,
  onModeChange,
  refreshing = false,
  exportsList,
  mountsList,
  peers,
  grants,
  names,
  routes,
  onRoute,
  onRefresh,
}: {
  mode: 'remote' | 'shared';
  onModeChange?(mode: 'remote' | 'shared'): void;
  refreshing?: boolean;
  exportsList: MountExport[];
  mountsList: MountRecord[];
  peers: Array<{ fingerprint: string }>;
  grants: MountGrant[];
  names: Record<string, string>;
  routes?: Record<string, PeerRoute>;
  onRoute?(route: PeerRoute): void;
  onRefresh(): Promise<void>;
}) {
  const { notify } = useNotifications();
  const [exportPath, setExportPath] = useState('');
  const [exportIdInput, setExportIdInput] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  const [selectedPeerByExport, setSelectedPeerByExport] = useState<Record<string, string>>({});
  const [mountPeer, setMountPeer] = useState('');
  const [mountConnReady, setMountConnReady] = useState(false);
  const [forceLanAddress, setForceLanAddress] = useState(false);
  const [showManualId, setShowManualId] = useState(false);

  const savedRoute = mountPeer ? routes?.[mountPeer] : undefined;
  const p2pRoute = !forceLanAddress && savedRoute?.adapter === 'p2p' && /^127\.0\.0\.1:[0-9]{1,5}$/.test(savedRoute.endpoint)
    ? savedRoute
    : undefined;
  const effectiveReady = Boolean(mountPeer) && (Boolean(p2pRoute) || mountConnReady);
  const [discovered, setDiscovered] = useState<ResourceDescriptor[]>([]);
  const [lastConn, setLastConn] = useState<{ adapter: string; endpoint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<MountFeedback>(null);
  const [mountFeedback, setMountFeedback] = useState<MountFeedback>(null);

  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [entries, setEntries] = useState<WebDAVEntry[]>([]);
  const [explorerError, setExplorerError] = useState<string>('');
  const [previewEntry, setPreviewEntry] = useState<WebDAVEntry | null>(null);
  const [previewChunk, setPreviewChunk] = useState<StreamChunk | null>(null);
  const [eventsFeed, setEventsFeed] = useState<ResourceEvent[]>([]);
  const [eventSeq, setEventSeq] = useState<number>(0);

  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [editingFile, setEditingFile] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorError, setEditorError] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [openRowMenuPath, setOpenRowMenuPath] = useState<string | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [entryFilter, setEntryFilter] = useState('');

  const activeSession = mountsList.find((m) => m.id === activeSessionId) ?? mountsList[0] ?? null;
  const activeResource = discovered.find((r) => r.id === activeSession?.remoteId) ?? null;
  const isReadOnlyResource = activeResource?.readOnly === true;

  useEffect(() => {
    if (!mountPeer && peers.length > 0) {
      setMountPeer(peers[0].fingerprint);
    }
  }, [mountPeer, peers]);

  useEffect(() => {
    if (activeSession && activeSession.id !== activeSessionId) {
      setActiveSessionId(activeSession.id);
    }
  }, [activeSession, activeSessionId]);

  useEffect(() => {
    if (!activeSession) {
      setEntries([]);
      setPreviewEntry(null);
      setPreviewChunk(null);
      return;
    }
    void loadDirectory(activeSession.id, '/');
    void refreshEvents(activeSession.id, 0);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!openRowMenuPath && !showHeaderMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.lr-menu-anchor')) return;
      setOpenRowMenuPath(null);
      setShowHeaderMenu(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenRowMenuPath(null);
        setShowHeaderMenu(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openRowMenuPath, showHeaderMenu]);

  async function pickExportDirectory() {
    const chosen = await window.lanvory.pickSyncDirectory().catch(() => null);
    if (chosen) {
      setExportPath(chosen);
      if (!exportIdInput.trim()) {
        setExportIdInput(suggestFolderId(chosen));
      }
    }
  }

  async function handleExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = exportIdInput.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !exportPath) {
      setExportFeedback({ tone: 'error', text: 'Choose a local folder and enter a short lowercase name (e.g. movies).' });
      return;
    }
    setBusy(true);
    setExportFeedback(null);
    try {
      const raw = await window.lanvory.exportMountFolder(id, exportPath, readOnly).catch(() => null);
      const parsed = mountExportSchema.safeParse(raw);
      if (parsed.success) {
        setExportIdInput('');
        setExportPath('');
        await onRefresh();
        setExportFeedback({
          tone: 'success',
          text: `Folder “${parsed.data.id}” is ready to share. Select a paired device on the right to allow access.`,
        });
      } else {
        const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Unable to share this folder.';
        setExportFeedback({ tone: 'error', text: errText });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscover(formEl: HTMLFormElement) {
    if (!mountPeer) {
      setMountFeedback({ tone: 'error', text: 'Select a paired device first.' });
      return;
    }
    let adapter = '';
    let endpoint = '';
    if (p2pRoute) {
      adapter = 'p2p';
      endpoint = p2pRoute.endpoint;
    } else {
      const form = new FormData(formEl);
      adapter = String(form.get('adapter') ?? '').trim();
      endpoint = String(form.get('endpoint') ?? '').trim();
      const validationErr = await connectionError(adapter, endpoint);
      if (validationErr) {
        setMountFeedback({ tone: 'error', text: validationErr });
        return;
      }
    }
    setBusy(true);
    setMountFeedback(null);
    try {
      const raw = await window.lanvory.discoverResources(adapter, endpoint, mountPeer).catch(() => null);
      const parsed = z.array(resourceDescriptorSchema).safeParse(raw);
      if (parsed.success) {
        setDiscovered(parsed.data);
        setLastConn({ adapter, endpoint });
        onRoute?.({ fingerprint: mountPeer, adapter, endpoint });
        setMountFeedback({
          tone: parsed.data.length > 0 ? 'success' : 'info',
          text: parsed.data.length > 0
            ? `Found ${parsed.data.length} shared folder(s) on ${pairedDeviceName(mountPeer, names)}.`
            : `${pairedDeviceName(mountPeer, names)} hasn’t shared any folders with you yet.`,
        });
      } else {
        const rawErr = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Could not reach the paired device.';
        if (/Unknown Wi-Fi P2P bridge endpoint/i.test(rawErr)) {
          setForceLanAddress(true);
          setMountFeedback({
            tone: 'info',
            text: 'The previous Bluetooth + Wi-Fi P2P session expired. Enter a LAN address below or reconnect under Devices → Bluetooth + P2P.',
          });
        } else if (/canceled by remote with error code 1/i.test(rawErr)) {
          setMountFeedback({
            tone: 'error',
            text: 'The remote device rejected this connection. Check that this device is trusted on the remote machine and its Local Network adapter is approved.',
          });
        } else {
          setMountFeedback({ tone: 'error', text: rawErr });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function openResourceSession(adapter: string, endpoint: string, remoteId: string) {
    setBusy(true);
    setMountFeedback(null);
    try {
      const raw = await window.lanvory.openMount(adapter, endpoint, mountPeer, remoteId).catch(() => null);
      const parsed = mountRecordSchema.safeParse(raw);
      if (parsed.success) {
        onRoute?.({ fingerprint: mountPeer, adapter, endpoint });
        await onRefresh();
        setActiveSessionId(parsed.data.id);
        setCurrentPath('/');
        setMountFeedback(null);
        notify({
          category: 'sync',
          tone: 'success',
          title: `Opened remote folder: ${parsed.data.remoteId}`,
          body: 'Files are ready to browse and stream on demand.',
        });
      } else {
        const rawErr = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Unable to open remote folder.';
        if (/Unknown Wi-Fi P2P bridge endpoint/i.test(rawErr)) {
          setForceLanAddress(true);
          setMountFeedback({
            tone: 'info',
            text: 'The previous Bluetooth + Wi-Fi P2P session expired. Enter a LAN address below or reconnect under Devices → Bluetooth + P2P.',
          });
        } else if (/canceled by remote with error code 1/i.test(rawErr)) {
          setMountFeedback({
            tone: 'error',
            text: 'The remote device rejected this connection. Check that this device is trusted on the remote machine and its Local Network adapter is approved.',
          });
        } else {
          setMountFeedback({ tone: 'error', text: rawErr });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleManualOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mountPeer) {
      setMountFeedback({ tone: 'error', text: 'Select a paired device first.' });
      return;
    }
    const form = new FormData(event.currentTarget);
    const remoteId = String(form.get('remoteId') ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(remoteId)) {
      setMountFeedback({ tone: 'error', text: 'Enter a valid lowercase folder name.' });
      return;
    }
    let adapter = '';
    let endpoint = '';
    if (p2pRoute) {
      adapter = 'p2p';
      endpoint = p2pRoute.endpoint;
    } else {
      adapter = String(form.get('adapter') ?? '').trim();
      endpoint = String(form.get('endpoint') ?? '').trim();
      const validationErr = await connectionError(adapter, endpoint);
      if (validationErr) {
        setMountFeedback({ tone: 'error', text: validationErr });
        return;
      }
    }
    await openResourceSession(adapter, endpoint, remoteId);
  }

  async function loadDirectory(sessionId: string, subPath: string, preservePreview = false): Promise<WebDAVEntry[] | null> {
    setExplorerError('');
    setConfirmDeletePath(null);
    setRenamingPath(null);
    const raw = await window.lanvory.browseResource(sessionId, subPath).catch(() => null);
    const parsed = z.array(entrySchema).safeParse(raw);
    if (parsed.success) {
      const sorted = [...parsed.data].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      setEntries(sorted);
      setCurrentPath(subPath);
      if (!preservePreview) {
        setPreviewEntry(null);
        setPreviewChunk(null);
        setEditingFile(false);
        setEditorError('');
      }
      return sorted;
    } else {
      const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
        ? raw.error
        : 'Unable to open this directory.';
      setExplorerError(errText);
      return null;
    }
  }

  async function previewFile(session: MountRecord, entry: WebDAVEntry, offset = 0) {
    setPreviewEntry(entry);
    setEditingFile(false);
    setEditorError('');
    if (isVideo(entry.name) || isAudio(entry.name) || isImage(entry.name)) {
      setPreviewChunk(null);
      return;
    }
    const raw = await window.lanvory.streamResourceChunk(session.id, entry.path, offset, 65536, entry.etag).catch(() => null);
    const parsed = streamChunkSchema.safeParse(raw);
    if (parsed.success) {
      setPreviewChunk(parsed.data);
    } else {
      setPreviewChunk(null);
    }
  }

  async function startEditingFile(session: MountRecord, entry: WebDAVEntry, chunk: StreamChunk) {
    setEditorError('');
    if (chunk.totalSize > 2 * 1024 * 1024) {
      setEditorError('Files larger than 2 MB cannot be edited inline. Use Open in Finder instead.');
      return;
    }
    let fullText = chunk.text ?? '';
    if (chunk.offset > 0 || chunk.offset + chunk.length < chunk.totalSize) {
      const raw = await window.lanvory
        .streamResourceChunk(session.id, entry.path, 0, Math.max(chunk.totalSize, 65536), entry.etag)
        .catch(() => null);
      const parsed = streamChunkSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.isText) {
        setEditorError('Unable to load the full file content for editing.');
        return;
      }
      fullText = parsed.data.text ?? '';
      setPreviewChunk(parsed.data);
    }
    setEditorContent(fullText);
    setEditingFile(true);
  }

  async function saveEditedFile() {
    if (!activeSession || !previewEntry) return;
    setSavingFile(true);
    setEditorError('');
    try {
      const res = await window.lanvory.writeResourceFile(activeSession.id, previewEntry.path, editorContent);
      if (!res.ok) {
        setEditorError(res.error || 'Unable to save file changes. Check if this folder allows editing.');
        return;
      }
      setEditingFile(false);
      const freshEntries = await loadDirectory(activeSession.id, currentPath, true);
      const freshEntry = freshEntries?.find((item) => item.path === previewEntry.path);
      const updatedEntry: WebDAVEntry = freshEntry ?? {
        ...previewEntry,
        size: new Blob([editorContent]).size,
        etag: undefined,
      };
      await previewFile(activeSession, updatedEntry, 0);
    } finally {
      setSavingFile(false);
    }
  }

  async function openSessionInFinder(session: MountRecord) {
    setExplorerError('');
    if (session.mounted && session.mountPoint) {
      const opened = await window.lanvory.openMountInFinder(session.mountPoint).catch(() => false);
      if (opened) return;
    }
    setBusy(true);
    try {
      const res = await window.lanvory.attachNativeMount(session.id).catch(() => null);
      await onRefresh();
      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        setExplorerError(res.error);
        return;
      }
      const parsed = mountRecordSchema.safeParse(res);
      if (parsed.success && parsed.data.mounted && parsed.data.mountPoint) {
        const opened = await window.lanvory.openMountInFinder(parsed.data.mountPoint).catch(() => false);
        if (!opened) {
          setExplorerError(`Mounted at ${parsed.data.mountPoint}, but macOS Finder could not open the folder.`);
        }
      } else if (parsed.success && parsed.data.mountError) {
        setExplorerError(`Finder integration failed: ${parsed.data.mountError}`);
      } else {
        setExplorerError('Unable to mount this folder in Finder.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshEvents(sessionId: string, since: number) {
    const raw = await window.lanvory.pollResourceEvents(sessionId, since).catch(() => null);
    const parsed = z.object({
      seq: z.number(),
      state: z.string(),
      events: z.array(eventSchema).nullable().optional(),
    }).safeParse(raw);
    if (parsed.success) {
      setEventSeq(parsed.data.seq);
      if (parsed.data.events && parsed.data.events.length > 0) {
        const list = parsed.data.events;
        setEventsFeed((prev) => [...list.reverse(), ...prev].slice(0, 10));
      }
      if (parsed.data.state === 'revoked') {
        setExplorerError('Access to this folder was turned off by the other device.');
        await onRefresh();
      }
    }
  }

  const breadcrumbs = currentPath === '/' ? ['/'] : ['/', ...currentPath.split('/').filter(Boolean)];
  const parentPath = currentPath === '/'
    ? '/'
    : '/' + currentPath.split('/').filter(Boolean).slice(0, -1).join('/');
  const filteredEntries = entryFilter.trim()
    ? entries.filter((entry) => entry.name.toLowerCase().includes(entryFilter.trim().toLowerCase()))
    : entries;

  if (mode === 'shared') {
    return (
      <div className="lr-shell">
        <header className="lr-shell-header">
          <div className="lr-shell-title">
            <Layers size={18} aria-hidden="true" />
            <h2>Live Resources</h2>
          </div>
          <div className="lr-shell-actions">
            <button
              type="button"
              className="lr-pill-btn"
              onClick={() => onModeChange?.('remote')}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>Browse remote</span>
            </button>
            <button
              type="button"
              className="lr-icon-btn"
              title="Refresh"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              <RefreshCw size={15} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="operation-grid" style={{ padding: 18 }}>
        <section className="operation-card operation-highlight">
          <PanelHeading
            icon={Plus}
            title="Share a folder"
            description="Let paired devices browse and stream files directly from this Mac without copying the entire folder."
          />
          <form className="trust-form" onSubmit={handleExport}>
            <label>
              Local folder
              <div className="sync-path-row">
                <input value={exportPath} readOnly placeholder="No folder selected" aria-label="Selected folder path" />
                <button type="button" className="refresh" onClick={() => void pickExportDirectory()} disabled={busy}>
                  Choose folder
                </button>
              </div>
            </label>
            <label>
              Share name
              <input
                name="exportId"
                value={exportIdInput}
                onChange={(e) => setExportIdInput(e.target.value)}
                placeholder="e.g. movies or project-files"
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <div className="lr-permission-field">
              <span className="lr-permission-label">Permission</span>
              <div className="lr-mode-pills" role="radiogroup" aria-label="Folder permission">
                <button
                  type="button"
                  role="radio"
                  aria-checked={readOnly}
                  className={`lr-mode-pill ${readOnly ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => setReadOnly(true)}
                >
                  <span className="lr-mode-pill-icon" aria-hidden="true">
                    <Eye size={16} />
                  </span>
                  <span className="lr-mode-pill-body">
                    <span className="lr-mode-pill-title">
                      <strong>View &amp; stream only</strong>
                      <span className="lr-mode-badge">Recommended</span>
                    </span>
                    <small>Read-only access</small>
                  </span>
                  <span className="lr-mode-pill-radio" aria-hidden="true">
                    {readOnly ? <Check size={12} /> : null}
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!readOnly}
                  className={`lr-mode-pill ${!readOnly ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => setReadOnly(false)}
                >
                  <span className="lr-mode-pill-icon" aria-hidden="true">
                    <Pencil size={16} />
                  </span>
                  <span className="lr-mode-pill-body">
                    <span className="lr-mode-pill-title">
                      <strong>Allow editing</strong>
                    </span>
                    <small>Create, rename &amp; delete</small>
                  </span>
                  <span className="lr-mode-pill-radio" aria-hidden="true">
                    {!readOnly ? <Check size={12} /> : null}
                  </span>
                </button>
              </div>
            </div>
            <button type="submit" className="primary" disabled={busy || !exportPath}>
              <Plus size={16} aria-hidden="true" />
              <span>Share folder</span>
            </button>
            <MountBanner feedback={exportFeedback} />
          </form>
        </section>

        <section className="operation-card">
          <PanelHeading
            icon={Folder}
            title="Shared folders"
            badge={exportsList.length > 0 ? <span className="badge-count">{exportsList.length}</span> : undefined}
            description="Choose which paired devices are allowed to browse each shared folder."
          />
          {exportsList.length === 0 ? (
            <p className="panel-empty">No folders shared yet. Choose a folder on the left to start sharing on demand.</p>
          ) : (
            <ul className="sync-folder-list">
              {exportsList.map((exp) => {
                const selectedPeer = selectedPeerByExport[exp.id] ?? '';
                const isAllowed = selectedPeer
                  ? grants.some(
                      (g) => !g.inactive && g.fingerprint === selectedPeer && g.capability === 'folder-mount' && g.resource === exp.id,
                    )
                  : false;
                return (
                  <li key={exp.id} className="sync-folder-card">
                    <div className="sync-folder-header">
                      <div className="sync-folder-identity">
                        <span className="sync-folder-icon"><Folder size={17} aria-hidden="true" /></span>
                        <div className="sync-folder-title">
                          <strong>{exp.id}</strong>
                          <span className={exp.readOnly ? 'state-pill' : 'state-pill is-active'}>
                            {exp.readOnly ? 'View only' : 'Editable'}
                          </span>
                        </div>
                      </div>
                      <div className="sync-folder-actions">
                        <button
                          type="button"
                          className="refresh sync-icon-btn sync-remove-btn"
                          title="Stop sharing"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void window.lanvory
                              .unexportMountFolder(exp.id)
                              .then(async (ok) => {
                                if (ok) await onRefresh();
                              })
                              .finally(() => setBusy(false));
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="sync-folder-path-row">
                      <Folder size={13} aria-hidden="true" />
                      <code className="sync-folder-path-pill" title={exp.path}>{exp.path}</code>
                    </div>
                    <div className="sync-peer-access">
                      <SelectField
                        label="Who can access"
                        value={selectedPeer}
                        disabled={busy}
                        placeholder={peers.length === 0 ? 'Pair a device first…' : 'Choose a paired device…'}
                        onValueChange={(fp) => setSelectedPeerByExport((prev) => ({ ...prev, [exp.id]: fp }))}
                        options={peers.map((p) => ({ value: p.fingerprint, label: pairedDeviceName(p.fingerprint, names) }))}
                      />
                      {selectedPeer && (
                        <div className="sync-peer-access-buttons">
                          <button
                            type="button"
                            className={isAllowed ? 'refresh sync-revoke-btn' : 'primary sync-allow-btn'}
                            disabled={busy}
                            onClick={() => {
                              setBusy(true);
                              void window.lanvory
                                .setMountAccess(selectedPeer, exp.id, !isAllowed)
                                .then(async (ok) => {
                                  if (ok) await onRefresh();
                                  setExportFeedback(
                                    ok
                                      ? {
                                          tone: isAllowed ? 'info' : 'success',
                                          text: `${isAllowed ? 'Removed' : 'Granted'} access to “${exp.id}” for ${pairedDeviceName(selectedPeer, names)}.`,
                                        }
                                      : { tone: 'error', text: 'Unable to update access.' },
                                  );
                                })
                                .finally(() => setBusy(false));
                            }}
                          >
                            {isAllowed ? 'Remove access' : 'Allow access'}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      </div>
    );
  }

  const activePeerName = mountPeer
    ? pairedDeviceName(mountPeer, names)
    : activeSession
      ? (activeSession.peerName || pairedDeviceName(activeSession.fingerprint, names))
      : 'No device';

  const sidebarResources = (() => {
    const items: Array<{ id: string; readOnly?: boolean; fileCount?: number; totalBytes?: number; session?: MountRecord }> = [];
    for (const res of discovered) {
      const existing = mountsList.find((m) => m.remoteId === res.id && (!mountPeer || m.fingerprint === mountPeer));
      items.push({ id: res.id, readOnly: res.readOnly, fileCount: res.fileCount, totalBytes: res.totalBytes, session: existing });
    }
    for (const m of mountsList) {
      if (mountPeer && m.fingerprint !== mountPeer) continue;
      if (!items.some((item) => item.id === m.remoteId)) {
        items.push({ id: m.remoteId, session: m });
      }
    }
    return items;
  })();

  const peerConnected = Boolean(
    p2pRoute ||
    lastConn ||
    mountsList.some((m) => m.fingerprint === mountPeer && m.state !== 'revoked'),
  );

  return (
    <div className="lr-shell">
      <header className="lr-shell-header">
        <div className="lr-shell-title">
          <Layers size={18} aria-hidden="true" />
          <h2>Live Resources</h2>
        </div>

        <div className="lr-shell-actions">
          <button
            type="button"
            className="lr-pill-btn"
            onClick={() => onModeChange?.('shared')}
          >
            <Share2 size={14} aria-hidden="true" />
            <span>Share folders</span>
            {exportsList.length > 0 && <span className="lr-pill-count">{exportsList.length}</span>}
          </button>
          <button
            type="button"
            className="lr-icon-btn"
            title="Refresh"
            disabled={refreshing || busy}
            onClick={() => {
              void onRefresh();
              if (activeSession) {
                void loadDirectory(activeSession.id, currentPath);
                void refreshEvents(activeSession.id, eventSeq);
              }
            }}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
          </button>
          <div className="lr-menu-anchor">
            <button
              type="button"
              className="lr-icon-btn"
              title="More options"
              onClick={() => setShowHeaderMenu((v) => !v)}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            {showHeaderMenu && (
              <div className="lr-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowManualId((v) => !v);
                    setShowHeaderMenu(false);
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{showManualId ? 'Hide manual folder input' : 'Open folder by name'}</span>
                </button>
                {p2pRoute && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setForceLanAddress(true);
                      setShowHeaderMenu(false);
                    }}
                  >
                    <HardDrive size={14} aria-hidden="true" />
                    <span>Use LAN address instead</span>
                  </button>
                )}
                {activeSession && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCreatingDir(true);
                        setNewDirName('');
                        setShowHeaderMenu(false);
                      }}
                    >
                      <FolderPlus size={14} aria-hidden="true" />
                      <span>New folder</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowHeaderMenu(false);
                        void openSessionInFinder(activeSession);
                      }}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>{activeSession.mounted ? 'Show in Finder' : 'Open in Finder'}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="lr-shell-body">
        <aside className="lr-sidebar" aria-label="Devices and Resources">
          <div className="lr-sidebar-group">
            <div className="lr-sidebar-label">DEVICES</div>
            {peers.length === 0 ? (
              <p className="lr-sidebar-empty">Pair a device first</p>
            ) : (
              <ul className="lr-sidebar-list">
                {peers.map((p) => {
                  const selected = mountPeer === p.fingerprint;
                  const pRoute = routes?.[p.fingerprint];
                  const isLive = selected ? peerConnected : Boolean(pRoute || mountsList.some((m) => m.fingerprint === p.fingerprint));
                  return (
                    <li key={p.fingerprint}>
                      <button
                        type="button"
                        className={`lr-device-item ${selected ? 'is-active' : ''}`}
                        onClick={() => {
                          setMountPeer(p.fingerprint);
                          setForceLanAddress(false);
                          setDiscovered([]);
                          setMountFeedback(null);
                        }}
                      >
                        <div className="lr-device-row">
                          <Laptop size={15} aria-hidden="true" />
                          <span>{pairedDeviceName(p.fingerprint, names)}</span>
                        </div>
                        {selected && (
                          <span className={`lr-device-status ${isLive ? 'is-online' : ''}`}>
                            <span className="lr-status-dot" aria-hidden="true" />
                            {isLive ? 'Connected' : 'Ready to connect'}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="lr-sidebar-divider" />

          <div className="lr-sidebar-group">
            <div className="lr-sidebar-label">RESOURCES</div>
            {sidebarResources.length === 0 ? (
              <p className="lr-sidebar-empty">No folders loaded</p>
            ) : (
              <ul className="lr-sidebar-list">
                {sidebarResources.map((item) => {
                  const isOpen = Boolean(item.session && activeSession?.id === item.session.id);
                  return (
                    <li key={item.id} className="lr-resource-li">
                      <button
                        type="button"
                        className={`lr-resource-item ${isOpen ? 'is-active' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          if (item.session) {
                            setActiveSessionId(item.session.id);
                            void loadDirectory(item.session.id, '/');
                          } else if (lastConn) {
                            void openResourceSession(lastConn.adapter, lastConn.endpoint, item.id);
                          } else if (p2pRoute) {
                            void openResourceSession('p2p', p2pRoute.endpoint, item.id);
                          }
                        }}
                      >
                        <Folder size={15} className="lr-folder-glyph" aria-hidden="true" />
                        <span>{item.id}</span>
                      </button>
                      {item.session && (
                        <button
                          type="button"
                          className="lr-resource-close"
                          title="Disconnect"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void window.lanvory.closeMount(item.session!.id).then(() => onRefresh()).finally(() => setBusy(false));
                          }}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              className="lr-sidebar-action"
              onClick={() => setShowManualId((v) => !v)}
            >
              <Plus size={13} aria-hidden="true" />
              <span>Open by name</span>
            </button>
          </div>
        </aside>

        <div className="lr-main">
          {(!activeSession || showManualId || (!p2pRoute && sidebarResources.length === 0)) && (
            <form className="lr-connect-inline trust-form" onSubmit={handleManualOpen}>
              {mountPeer && !p2pRoute && (
                <PeerConnectionFields
                  suggestedEndpoint={lanSuggestedEndpoint(savedRoute)}
                  endpointLabel="Device address"
                  adapterLabel="Network adapter"
                  disabled={busy}
                  onReady={setMountConnReady}
                />
              )}
              <div className="lr-connect-toolbar">
                {p2pRoute && (
                  <div className="lr-connect-route">
                    <span className="lr-connect-route-icon"><Bluetooth size={19} aria-hidden="true" /></span>
                    <div className="lr-connect-route-copy">
                      <strong>Bluetooth + Wi-Fi P2P</strong>
                      <small>Direct connection <code title="Local bridge endpoint">{p2pRoute.endpoint}</code></small>
                    </div>
                  </div>
                )}
                <div className="lr-connect-actions">
                  {p2pRoute && (
                    <button type="button" className="lr-connect-switch" disabled={busy} onClick={() => setForceLanAddress(true)}>
                      <Network size={15} aria-hidden="true" />
                      Use LAN instead
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !effectiveReady}
                    onClick={(e) => {
                      const form = e.currentTarget.form;
                      if (form) void handleDiscover(form);
                    }}
                  >
                    <Search size={15} aria-hidden="true" />
                    <span>Find shared folders</span>
                  </button>
                </div>
              </div>
              {showManualId && (
                <div className="sync-path-row" style={{ marginTop: 10 }}>
                  <input name="remoteId" placeholder="Folder name (e.g. test, movies)" autoComplete="off" disabled={busy} />
                  <button type="submit" className="refresh" disabled={busy || !effectiveReady}>
                    Open
                  </button>
                </div>
              )}
              <MountBanner feedback={mountFeedback} />
            </form>
          )}

          {activeSession ? (
            <>
              <div className="lr-main-bar">
                <div className="lr-breadcrumbs">
                  {currentPath !== '/' && (
                    <button
                      type="button"
                      className="lr-icon-btn"
                      title="Back"
                      onClick={() => void loadDirectory(activeSession.id, parentPath)}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                  )}
                  <span className="lr-crumb-root">{activePeerName}</span>
                  <span className="lr-crumb-sep">/</span>
                  {breadcrumbs.map((seg, idx) => {
                    const target = idx === 0 ? '/' : '/' + breadcrumbs.slice(1, idx + 1).join('/');
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <span key={target} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {idx > 0 && <span className="lr-crumb-sep">/</span>}
                        <button
                          type="button"
                          className={`lr-crumb ${isLast ? 'is-current' : ''}`}
                          onClick={() => void loadDirectory(activeSession.id, target)}
                        >
                          {seg === '/' ? activeSession.remoteId : seg}
                        </button>
                      </span>
                    );
                  })}
                </div>

                <div className="lr-toolbar-actions">
                  {activeResource && (
                    <span className={isReadOnlyResource ? 'state-pill' : 'state-pill is-active'}>
                      {isReadOnlyResource ? 'View only' : 'Editable'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="lr-action-btn"
                    title={isReadOnlyResource ? 'This shared folder is View only' : 'Create a new file'}
                    disabled={isReadOnlyResource}
                    onClick={() => {
                      setCreatingFile((v) => !v);
                      setCreatingDir(false);
                      setNewFileName('');
                    }}
                  >
                    <FilePlus size={14} aria-hidden="true" />
                    <span>New file</span>
                  </button>
                  <button
                    type="button"
                    className="lr-action-btn"
                    title={isReadOnlyResource ? 'This shared folder is View only' : 'Create a new folder'}
                    disabled={isReadOnlyResource}
                    onClick={() => {
                      setCreatingDir((v) => !v);
                      setCreatingFile(false);
                      setNewDirName('');
                    }}
                  >
                    <FolderPlus size={14} aria-hidden="true" />
                    <span>New folder</span>
                  </button>
                  <button
                    type="button"
                    className="lr-action-btn"
                    title={activeSession.mounted ? 'Show in Finder' : 'Open in Finder'}
                    onClick={() => void openSessionInFinder(activeSession)}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{activeSession.mounted ? 'Finder' : 'Open in Finder'}</span>
                  </button>
                </div>
              </div>

              {entries.length > 0 && (
                <div className="lr-filter-row">
                  <div className="lr-search-input">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      value={entryFilter}
                      onChange={(e) => setEntryFilter(e.target.value)}
                      placeholder="Filter files and folders…"
                      aria-label="Filter files and folders"
                    />
                  </div>
                  <span className="lr-entry-count">
                    {filteredEntries.length} {filteredEntries.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
              )}

              {creatingFile && (
                <form
                  className="lr-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const clean = newFileName.trim();
                    if (!clean) return;
                    const nextPath = currentPath === '/' ? `/${clean}` : `${currentPath}/${clean}`;
                    void window.lanvory.writeResourceFile(activeSession.id, nextPath, '').then(async (res) => {
                      if (!res.ok) {
                        setExplorerError(res.error || 'Unable to create file.');
                        return;
                      }
                      setCreatingFile(false);
                      setNewFileName('');
                      await loadDirectory(activeSession.id, currentPath);
                      const createdEntry: WebDAVEntry = { name: clean, path: nextPath, isDir: false, size: 0 };
                      await previewFile(activeSession, createdEntry, 0);
                      setEditorContent('');
                      setEditingFile(true);
                    });
                  }}
                >
                  <FilePlus size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="New file name (e.g. notes.txt)…"
                  />
                  <button type="button" className="refresh" onClick={() => setCreatingFile(false)}>Cancel</button>
                  <button type="submit" className="primary">Create</button>
                </form>
              )}

              {creatingDir && (
                <form
                  className="lr-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const clean = newDirName.trim();
                    if (!clean) return;
                    const next = currentPath === '/' ? `/${clean}` : `${currentPath}/${clean}`;
                    void window.lanvory.createResourceDir(activeSession.id, next).then((res) => {
                      if (!res.ok && res.error) setExplorerError(res.error);
                      setCreatingDir(false);
                      setNewDirName('');
                      void loadDirectory(activeSession.id, currentPath);
                    });
                  }}
                >
                  <FolderPlus size={15} aria-hidden="true" />
                  <input
                    autoFocus
                    value={newDirName}
                    onChange={(e) => setNewDirName(e.target.value)}
                    placeholder="New folder name…"
                  />
                  <button type="button" className="refresh" onClick={() => setCreatingDir(false)}>Cancel</button>
                  <button type="submit" className="primary">Create</button>
                </form>
              )}

              {explorerError && (
                <div style={{ padding: '10px 0 0' }}>
                  <MountBanner feedback={{ tone: 'error', text: explorerError }} />
                </div>
              )}

              {filteredEntries.length === 0 ? (
                <div className="lr-empty-state">
                  <Folder size={26} aria-hidden="true" />
                  <span>{entries.length === 0 ? 'This folder is empty.' : 'No matching files or folders.'}</span>
                </div>
              ) : (
                <ul className="lr-list">
                  {filteredEntries.map((entry) => {
                    const isSelected = previewEntry?.path === entry.path;
                    const isRenaming = renamingPath === entry.path;
                    const isConfirmDelete = confirmDeletePath === entry.path;
                    return (
                      <li key={entry.path} className={`lr-row ${isSelected ? 'is-selected' : ''}`}>
                        {isRenaming ? (
                          <form
                            className="lr-inline-form"
                            style={{ flex: 1, margin: 0, padding: '6px 8px' }}
                            onSubmit={(e) => {
                              e.preventDefault();
                              const nextName = renameValue.trim();
                              if (!nextName || nextName === entry.name) {
                                setRenamingPath(null);
                                return;
                              }
                              const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '';
                              const newPath = `${parent}/${nextName}`;
                              void window.lanvory.renameResourceEntry(activeSession.id, entry.path, newPath).then((res) => {
                                if (!res.ok && res.error) setExplorerError(res.error);
                                setRenamingPath(null);
                                void loadDirectory(activeSession.id, currentPath);
                              });
                            }}
                          >
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                            />
                            <button type="submit" className="lr-icon-btn" title="Save"><Check size={14} /></button>
                            <button type="button" className="lr-icon-btn" title="Cancel" onClick={() => setRenamingPath(null)}><X size={14} /></button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="lr-row-main"
                              onClick={() => {
                                setOpenRowMenuPath(null);
                                if (entry.isDir) {
                                  void loadDirectory(activeSession.id, entry.path);
                                } else {
                                  void previewFile(activeSession, entry, 0);
                                }
                              }}
                            >
                              <span className={`lr-row-icon ${entry.isDir ? 'is-dir' : ''}`}>
                                <EntryIcon entry={entry} />
                              </span>
                              <span className="lr-row-text">
                                <span className="lr-row-name" title={entry.name}>{entry.name}</span>
                                <span className="lr-row-meta">{entry.isDir ? 'Folder' : formatBytes(entry.size)}</span>
                              </span>
                            </button>

                            <div className="lr-row-end">
                              {isConfirmDelete ? (
                                <div className="lr-row-confirm">
                                  <button
                                    type="button"
                                    className="lr-row-delete-confirm"
                                    onClick={() => {
                                      void window.lanvory.deleteResourceEntry(activeSession.id, entry.path).then((res) => {
                                        if (!res.ok && res.error) setExplorerError(res.error);
                                        setConfirmDeletePath(null);
                                        void loadDirectory(activeSession.id, currentPath);
                                      });
                                    }}
                                  >
                                    Delete
                                  </button>
                                  <button type="button" className="lr-icon-btn" title="Cancel" onClick={() => setConfirmDeletePath(null)}>
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div className="lr-row-actions">
                                  {!entry.isDir && (
                                    <button
                                      type="button"
                                      className="lr-icon-btn"
                                      title="Preview file"
                                      onClick={() => void previewFile(activeSession, entry, 0)}
                                    >
                                      <Eye size={14} aria-hidden="true" />
                                    </button>
                                  )}
                                  {!isReadOnlyResource && (
                                    <>
                                      <button
                                        type="button"
                                        className="lr-icon-btn"
                                        title="Rename"
                                        onClick={() => {
                                          setRenamingPath(entry.path);
                                          setRenameValue(entry.name);
                                          setConfirmDeletePath(null);
                                        }}
                                      >
                                        <Pencil size={14} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        className="lr-icon-btn is-danger"
                                        title="Delete"
                                        onClick={() => {
                                          setConfirmDeletePath(entry.path);
                                          setRenamingPath(null);
                                        }}
                                      >
                                        <Trash2 size={14} aria-hidden="true" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {previewEntry && (
                <div className="lr-preview-drawer">
                  <div className="lr-preview-head">
                    <h4 title={previewEntry.name}>{previewEntry.name}</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="pill-badge">{formatBytes(previewEntry.size)}</span>
                      {previewChunk?.isText && !editingFile && (
                        <button
                          type="button"
                          className="refresh"
                          style={{ minHeight: 28, padding: '0 10px', fontSize: '.76rem' }}
                          disabled={isReadOnlyResource}
                          title={isReadOnlyResource ? 'This shared folder is View only' : 'Edit file'}
                          onClick={() => void startEditingFile(activeSession, previewEntry, previewChunk)}
                        >
                          <Pencil size={12} aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="lr-icon-btn"
                        title="Close preview"
                        onClick={() => {
                          setPreviewEntry(null);
                          setEditingFile(false);
                          setEditorError('');
                        }}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {editorError && <MountBanner feedback={{ tone: 'error', text: editorError }} />}
                  {isVideo(previewEntry.name) && (
                    <video
                      controls
                      preload="metadata"
                      className="lr-preview-media"
                      src={`${activeSession.url.replace(/\/$/, '')}${previewEntry.path}`}
                    />
                  )}
                  {isAudio(previewEntry.name) && (
                    <audio
                      controls
                      preload="metadata"
                      style={{ width: '100%' }}
                      src={`${activeSession.url.replace(/\/$/, '')}${previewEntry.path}`}
                    />
                  )}
                  {isImage(previewEntry.name) && (
                    <img
                      alt={previewEntry.name}
                      className="lr-preview-media"
                      src={`${activeSession.url.replace(/\/$/, '')}${previewEntry.path}`}
                    />
                  )}
                  {!isVideo(previewEntry.name) && !isAudio(previewEntry.name) && !isImage(previewEntry.name) && previewChunk && (
                    editingFile ? (
                      <>
                        <textarea
                          className="lr-editor-textarea"
                          value={editorContent}
                          onChange={(e) => setEditorContent(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                              e.preventDefault();
                              if (!savingFile) void saveEditedFile();
                            }
                          }}
                          aria-label={`Edit ${previewEntry.name}`}
                          spellCheck={false}
                        />
                        <div className="lr-editor-actions">
                          <span className="lr-editor-hint">Press Cmd/Ctrl + S to save</span>
                          <div className="lr-editor-buttons">
                            <button
                              type="button"
                              className="refresh"
                              disabled={savingFile}
                              onClick={() => {
                                setEditingFile(false);
                                setEditorError('');
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="primary"
                              disabled={savingFile}
                              onClick={() => void saveEditedFile()}
                            >
                              <Save size={14} aria-hidden="true" />
                              <span>{savingFile ? 'Saving…' : 'Save changes'}</span>
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="lr-resource-meta">
                          Streaming on demand · {formatBytes(previewChunk.offset + previewChunk.length)} of {formatBytes(previewChunk.totalSize)} loaded
                        </div>
                        {previewChunk.isText ? (
                          <pre className="lr-preview-code">{previewChunk.text}</pre>
                        ) : (
                          <p className="panel-hint">Binary file preview is not available ({formatBytes(previewChunk.length)} loaded).</p>
                        )}
                        {previewChunk.offset + previewChunk.length < previewChunk.totalSize && (
                          <button
                            type="button"
                            className="refresh"
                            style={{ justifySelf: 'start' }}
                            onClick={() => void previewFile(activeSession, previewEntry, previewChunk.offset + previewChunk.length)}
                          >
                            <span>Load next 64 KB</span>
                          </button>
                        )}
                      </>
                    )
                  )}
                </div>
              )}

              {eventsFeed.length > 0 && (
                <div className="lr-activity-strip">
                  <span>Latest update: {friendlyEventText(eventsFeed[0])}</span>
                  <span>{eventsFeed.length} recent change(s)</span>
                </div>
              )}
            </>
          ) : (
            <div className="lr-empty-state">
              <Layers size={28} aria-hidden="true" />
              <span>Select a device and resource on the left, or click Find shared folders.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

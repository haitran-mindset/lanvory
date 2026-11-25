import { type FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Info,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { connectionError, PeerConnectionFields } from '../../components/peer-connection-fields';
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
  const [showManualId, setShowManualId] = useState(false);
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
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const activeSession = mountsList.find((m) => m.id === activeSessionId) ?? mountsList[0] ?? null;

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
    const form = new FormData(formEl);
    const adapter = String(form.get('adapter') ?? '').trim();
    const endpoint = String(form.get('endpoint') ?? '').trim();
    const validationErr = await connectionError(adapter, endpoint);
    if (validationErr) {
      setMountFeedback({ tone: 'error', text: validationErr });
      return;
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
        const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Could not reach the paired device.';
        setMountFeedback({ tone: 'error', text: errText });
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
        const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Unable to open remote folder.';
        setMountFeedback({ tone: 'error', text: errText });
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
    const adapter = String(form.get('adapter') ?? '').trim();
    const endpoint = String(form.get('endpoint') ?? '').trim();
    const remoteId = String(form.get('remoteId') ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(remoteId)) {
      setMountFeedback({ tone: 'error', text: 'Enter a valid lowercase folder name.' });
      return;
    }
    const validationErr = await connectionError(adapter, endpoint);
    if (validationErr) {
      setMountFeedback({ tone: 'error', text: validationErr });
      return;
    }
    await openResourceSession(adapter, endpoint, remoteId);
  }

  async function loadDirectory(sessionId: string, subPath: string) {
    setExplorerError('');
    setConfirmDeletePath(null);
    setRenamingPath(null);
    const raw = await window.lanvory.browseResource(sessionId, subPath).catch(() => null);
    const parsed = z.array(entrySchema).safeParse(raw);
    if (parsed.success) {
      const sorted = [...parsed.data].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      setEntries(sorted);
      setCurrentPath(subPath);
      setPreviewEntry(null);
      setPreviewChunk(null);
    } else {
      const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
        ? raw.error
        : 'Unable to open this directory.';
      setExplorerError(errText);
    }
  }

  async function previewFile(session: MountRecord, entry: WebDAVEntry, offset = 0) {
    setPreviewEntry(entry);
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

  if (mode === 'shared') {
    return (
      <div className="operation-grid">
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
            <div className="field">
              <span>Permission</span>
              <div className="lr-mode-pills">
                <button
                  type="button"
                  className={`lr-mode-pill ${readOnly ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => setReadOnly(true)}
                >
                  <strong>View & stream only</strong>
                  <small>Recommended · Read-only</small>
                </button>
                <button
                  type="button"
                  className={`lr-mode-pill ${!readOnly ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => setReadOnly(false)}
                >
                  <strong>Allow editing</strong>
                  <small>Create, rename & delete</small>
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
    );
  }

  return (
    <div className="lr-panel">
      <section className="operation-card operation-highlight">
        <PanelHeading
          icon={HardDrive}
          title="Access remote folders"
          description="Select a paired device to browse folders and stream videos or documents on demand."
        />

        <form className="trust-form" onSubmit={handleManualOpen}>
          <div className="lr-connect-row">
            <SelectField
              label="Paired device"
              value={mountPeer}
              disabled={busy}
              placeholder={peers.length === 0 ? 'Pair a device first…' : 'Choose a paired device…'}
              onValueChange={(fp) => {
                setMountPeer(fp);
                setDiscovered([]);
              }}
              options={peers.map((p) => ({ value: p.fingerprint, label: pairedDeviceName(p.fingerprint, names) }))}
            />
            <button
              type="button"
              className="primary"
              disabled={busy || !mountPeer || !mountConnReady}
              onClick={(e) => {
                const form = e.currentTarget.closest('form');
                if (form) void handleDiscover(form);
              }}
            >
              <Search size={14} aria-hidden="true" />
              <span>Find shared folders</span>
            </button>
          </div>

          {mountPeer && (
            <PeerConnectionFields
              suggestedEndpoint={routes?.[mountPeer]?.endpoint}
              endpointLabel="Device address"
              adapterLabel="Network adapter"
              disabled={busy}
              onReady={setMountConnReady}
            />
          )}

          <div className="lr-sub-actions">
            <button
              type="button"
              className="lr-link-btn"
              onClick={() => setShowManualId((v) => !v)}
            >
              {showManualId ? 'Hide manual folder name' : 'Or enter a folder name manually'}
            </button>
          </div>

          {showManualId && (
            <label>
              Folder name
              <div className="sync-path-row">
                <input name="remoteId" placeholder="e.g. movies" autoComplete="off" disabled={busy} />
                <button type="submit" className="refresh" disabled={busy || !mountPeer || !mountConnReady}>
                  Open
                </button>
              </div>
            </label>
          )}
          <MountBanner feedback={mountFeedback} />
        </form>

        {(discovered.length > 0 || mountsList.length > 0) && (
          <div className="lr-shelf">
            {discovered.map((res) => {
              const existing = mountsList.find((m) => m.remoteId === res.id && (!mountPeer || m.fingerprint === mountPeer));
              const isOpen = Boolean(existing && activeSession?.id === existing.id);
              return (
                <div key={res.id} className={`lr-shelf-item ${isOpen ? 'is-active' : ''}`}>
                  <div className="lr-shelf-info">
                    <span className="lr-folder-badge"><Folder size={17} aria-hidden="true" /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="lr-resource-name">{res.id}</div>
                      <div className="lr-resource-meta">
                        {res.readOnly ? 'View only' : 'Editable'} · {res.fileCount} files · {formatBytes(res.totalBytes)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {existing ? (
                      <>
                        <button
                          type="button"
                          className={isOpen ? 'primary' : 'refresh'}
                          onClick={() => {
                            setActiveSessionId(existing.id);
                            void loadDirectory(existing.id, '/');
                          }}
                        >
                          {isOpen ? 'Open' : 'Browse'}
                        </button>
                        <button
                          type="button"
                          className="lr-icon-btn"
                          title="Disconnect"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void window.lanvory.closeMount(existing.id).then(() => onRefresh()).finally(() => setBusy(false));
                          }}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      lastConn && (
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() => void openResourceSession(lastConn.adapter, lastConn.endpoint, res.id)}
                        >
                          Open
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {mountsList
              .filter((m) => !discovered.some((d) => d.id === m.remoteId))
              .map((m) => {
                const isOpen = activeSession?.id === m.id;
                return (
                  <div key={m.id} className={`lr-shelf-item ${isOpen ? 'is-active' : ''}`}>
                    <div className="lr-shelf-info">
                      <span className="lr-folder-badge"><Folder size={17} aria-hidden="true" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="lr-resource-name">{m.remoteId}</div>
                        <div className="lr-resource-meta">
                          {m.state === 'revoked' ? 'Access revoked' : 'Connected'}{m.mounted ? ' · In Finder' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className={isOpen ? 'primary' : 'refresh'}
                        onClick={() => {
                          setActiveSessionId(m.id);
                          void loadDirectory(m.id, '/');
                        }}
                      >
                        {isOpen ? 'Open' : 'Browse'}
                      </button>
                      <button
                        type="button"
                        className="lr-icon-btn"
                        title="Disconnect"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void window.lanvory.closeMount(m.id).then(() => onRefresh()).finally(() => setBusy(false));
                        }}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {activeSession && (
        <section className="lr-explorer" aria-label="Folder Explorer">
          <div className="lr-explorer-toolbar">
            <div className="lr-breadcrumbs">
              {currentPath !== '/' && (
                <button
                  type="button"
                  className="lr-icon-btn"
                  title="Up one folder"
                  onClick={() => void loadDirectory(activeSession.id, parentPath)}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                </button>
              )}
              {breadcrumbs.map((seg, idx) => {
                const target = idx === 0 ? '/' : '/' + breadcrumbs.slice(1, idx + 1).join('/');
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <span key={target} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {idx > 0 && <ChevronRight size={13} className="lr-crumb-sep" aria-hidden="true" />}
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
              <button
                type="button"
                className="refresh"
                onClick={() => {
                  setCreatingDir((v) => !v);
                  setNewDirName('');
                }}
              >
                <FolderPlus size={14} aria-hidden="true" />
                <span>New folder</span>
              </button>
              <button
                type="button"
                className="refresh"
                onClick={() => {
                  void loadDirectory(activeSession.id, currentPath);
                  void refreshEvents(activeSession.id, eventSeq);
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                className="refresh"
                title="Optional: open this folder in macOS Finder"
                onClick={() => {
                  if (activeSession.mounted && activeSession.mountPoint) {
                    void window.lanvory.openMountInFinder(activeSession.mountPoint);
                    return;
                  }
                  setBusy(true);
                  void window.lanvory
                    .attachNativeMount(activeSession.id)
                    .then(async (res) => {
                      await onRefresh();
                      const parsed = mountRecordSchema.safeParse(res);
                      if (parsed.success && parsed.data.mounted && parsed.data.mountPoint) {
                        void window.lanvory.openMountInFinder(parsed.data.mountPoint);
                      } else if (parsed.success && parsed.data.mountError) {
                        setExplorerError('Finder integration is not available on this Mac — continue using the built-in browser.');
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span>{activeSession.mounted ? 'Show in Finder' : 'Open in Finder'}</span>
              </button>
            </div>
          </div>

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
              <button type="submit" className="primary">Create</button>
              <button type="button" className="refresh" onClick={() => setCreatingDir(false)}>Cancel</button>
            </form>
          )}

          {explorerError && (
            <div style={{ padding: '10px 16px 0' }}>
              <MountBanner feedback={{ tone: 'error', text: explorerError }} />
            </div>
          )}

          <div className="lr-explorer-split">
            <div className="lr-file-pane">
              {entries.length === 0 ? (
                <div className="lr-preview-empty">
                  <Folder size={24} aria-hidden="true" />
                  <span>This folder is empty.</span>
                </div>
              ) : (
                <ul className="lr-file-list">
                  {entries.map((entry) => {
                    const isSelected = previewEntry?.path === entry.path;
                    const isRenaming = renamingPath === entry.path;
                    const isConfirmDelete = confirmDeletePath === entry.path;
                    return (
                      <li key={entry.path} className={`lr-file-row ${isSelected ? 'is-selected' : ''}`}>
                        {isRenaming ? (
                          <form
                            className="lr-inline-form"
                            style={{ flex: 1, padding: '4px 6px', borderRadius: 8 }}
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
                              className="lr-file-main"
                              onClick={() => {
                                if (entry.isDir) {
                                  void loadDirectory(activeSession.id, entry.path);
                                } else {
                                  void previewFile(activeSession, entry, 0);
                                }
                              }}
                            >
                              <span className={`lr-file-icon ${entry.isDir ? 'is-dir' : ''}`}>
                                <EntryIcon entry={entry} />
                              </span>
                              <span className="lr-file-name" title={entry.name}>{entry.name}</span>
                              {!entry.isDir && <span className="lr-file-size">{formatBytes(entry.size)}</span>}
                            </button>
                            <div className="lr-row-actions">
                              {isConfirmDelete ? (
                                <>
                                  <button
                                    type="button"
                                    className="refresh"
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
                                  <button type="button" className="lr-icon-btn" onClick={() => setConfirmDeletePath(null)}>
                                    <X size={13} />
                                  </button>
                                </>
                              ) : (
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
                                    <Pencil size={13} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="lr-icon-btn"
                                    title="Delete"
                                    onClick={() => {
                                      setConfirmDeletePath(entry.path);
                                      setRenamingPath(null);
                                    }}
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="lr-preview-pane">
              {previewEntry ? (
                <>
                  <div className="lr-preview-head">
                    <h4 title={previewEntry.name}>{previewEntry.name}</h4>
                    <span className="pill-badge">{formatBytes(previewEntry.size)}</span>
                  </div>
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
                  )}
                </>
              ) : (
                <div className="lr-preview-empty">
                  <FileText size={26} aria-hidden="true" />
                  <span>Select any file on the left to preview or stream it instantly.</span>
                </div>
              )}
            </div>
          </div>

          {eventsFeed.length > 0 && (
            <div className="lr-activity-strip">
              <span>Latest update: {friendlyEventText(eventsFeed[0])}</span>
              <span>{eventsFeed.length} recent change(s)</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

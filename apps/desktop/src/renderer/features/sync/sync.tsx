import { WorkspaceTabs, WorkspaceTabPanel } from '../../components/workspace-tabs';
import { type FormEvent, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Folder, FolderSync, Info, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { PanelHeading } from '../../components/panel-heading';
import { connectionError, isP2PRoute, lanSuggestedEndpoint, PeerConnectionFields } from '../../components/peer-connection-fields';
import { SelectField } from '../../components/ui/select';
import { useNotifications } from '../../components/notifications';
import { pairedDeviceName, readPairedNames } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';

const folderSchema = z.object({
  id: z.string(),
  path: z.string(),
  mode: z.enum(['send-only', 'receive-only', 'bidirectional']),
  paused: z.boolean(),
  fileCount: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  lastScanAt: z.string().optional(),
  files: z
    .array(
      z.object({
        relativePath: z.string(),
        size: z.number(),
        sha256: z.string(),
        version: z.number(),
      }),
    )
    .optional(),
  conflicts: z
    .array(
      z.object({
        relativePath: z.string(),
        conflictCopy: z.string(),
        detectedAt: z.string(),
      }),
    )
    .optional(),
});

const foldersSchema = z.array(folderSchema);
const syncResultSchema = z.object({
  folderId: z.string(),
  downloaded: z.number().nonnegative(),
  uploaded: z.number().nonnegative(),
  conflicts: z.number().nonnegative(),
  skipped: z.number().nonnegative(),
  folder: folderSchema,
});
const grantSchema = z.object({
  fingerprint: z.string(),
  capability: z.string(),
  resource: z.string(),
  inactive: z.boolean().optional(),
});
type SyncGrant = z.infer<typeof grantSchema>;
type SyncFolder = z.infer<typeof folderSchema>;

const modeOptions = [
  { value: 'bidirectional', label: 'Bidirectional' },
  { value: 'send-only', label: 'Send only' },
  { value: 'receive-only', label: 'Receive only' },
] as const;

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

type SyncFeedback = { tone: 'success' | 'info' | 'error'; text: string } | null;

function SyncBanner({ feedback }: { feedback: SyncFeedback }) {
  if (!feedback) return null;
  const Icon = feedback.tone === 'success' ? CheckCircle2 : feedback.tone === 'error' ? AlertCircle : Info;
  return (
    <div className={`sync-feedback-banner is-${feedback.tone}`} role="status">
      <Icon size={15} aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  );
}

export function SyncPanel({ visible, ownerId, routes, onRoute }: {
  visible: boolean;
  ownerId?: string;
  routes?: Record<string, PeerRoute>;
  onRoute?(route: PeerRoute): void;
}) {
  const { notify } = useNotifications();
  const [folders, setFolders] = useState<SyncFolder[] | null>();
  const [peers, setPeers] = useState<Array<{ fingerprint: string }>>([]);
  const [grants, setGrants] = useState<SyncGrant[]>([]);
  const [selectedPeerByFolder, setSelectedPeerByFolder] = useState<Record<string, string>>({});
  const [connectionReadyByFolder, setConnectionReadyByFolder] = useState<Record<string, boolean>>({});
  const [pickedPath, setPickedPath] = useState('');
  const [mode, setMode] = useState<'send-only' | 'receive-only' | 'bidirectional'>('bidirectional');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'folders' | 'add'>('folders');
  const [addMessage, setAddMessage] = useState<SyncFeedback>(null);
  const [listMessage, setListMessage] = useState<SyncFeedback>(null);
  const names = ownerId ? readPairedNames(ownerId) : {};

  async function refresh() {
    const [rawFolders, rawPeers, rawServiceSnap] = await Promise.all([
      window.lanvory.syncFolders().catch(() => null),
      window.lanvory.trustedPeers().catch(() => null),
      window.lanvory.serviceSnapshot().catch(() => null),
    ]);
    const parsed = foldersSchema.safeParse(rawFolders);
    setFolders(parsed.success ? parsed.data : null);
    const parsedPeers = z.array(z.object({ fingerprint: z.string() })).safeParse(rawPeers);
    if (parsedPeers.success) setPeers(parsedPeers.data);
    const parsedGrants = z.object({ grants: z.array(grantSchema) }).safeParse(rawServiceSnap);
    if (parsedGrants.success) setGrants(parsedGrants.data.grants);
  }

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [visible]);

  async function pickDirectory() {
    const chosen = await window.lanvory.pickSyncDirectory().catch(() => null);
    if (chosen) setPickedPath(chosen);
  }

  async function addFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const id = String(form.get('id') ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !pickedPath) {
      setAddMessage({ tone: 'error', text: 'Enter a lowercase folder ID and choose a local directory.' });
      return;
    }
    setBusy(true);
    setAddMessage(null);
    try {
      const raw = await window.lanvory.addSyncFolder(id, pickedPath, mode).catch(() => null);
      const created = folderSchema.safeParse(raw);
      if (created.success) {
        formEl.reset();
        setPickedPath('');
        await refresh();
        setAddMessage({ tone: 'success', text: `Registered sync folder “${created.data.id}”.` });
        setListMessage(null);
        notify({
          category: 'sync',
          tone: 'success',
          title: `Sync folder added: ${created.data.id}`,
          body: created.data.path,
        });
      } else {
        const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Unable to register folder. Check that the ID is unique and the daemon is up to date.';
        setAddMessage({ tone: 'error', text: errText });
      }
    } finally {
      setBusy(false);
    }
  }

  async function scanFolder(id: string) {
    setBusy(true);
    setListMessage(null);
    const scanned = folderSchema.safeParse(await window.lanvory.scanSyncFolder(id).catch(() => null));
    if (scanned.success) {
      setFolders((prev) => prev?.map((f) => (f.id === id ? scanned.data : f)) ?? [scanned.data]);
      setListMessage(null);
      notify({
        category: 'sync',
        tone: 'success',
        title: `Sync scan finished: ${id}`,
        body: `${scanned.data.fileCount} files indexed (${formatBytes(scanned.data.totalBytes)}).`,
      });
    } else {
      setListMessage({ tone: 'error', text: `Unable to scan “${id}”.` });
    }
    setBusy(false);
  }

  async function syncWithPeer(event: FormEvent<HTMLFormElement>, folderId: string) {
    event.preventDefault();
    const fp = selectedPeerByFolder[folderId];
    if (!fp) return;
    const peerRoute = routes?.[fp];
    const useP2P = isP2PRoute(peerRoute);
    const form = new FormData(event.currentTarget);
    const adapter = useP2P ? peerRoute!.adapter : String(form.get('adapter') ?? '').trim();
    const endpoint = useP2P ? peerRoute!.endpoint : String(form.get('endpoint') ?? '').trim();
    if (!useP2P) {
      const validationErr = await connectionError(adapter, endpoint);
      if (validationErr) {
        setListMessage({ tone: 'error', text: validationErr });
        return;
      }
    }
    setBusy(true);
    setListMessage({ tone: 'info', text: `Syncing “${folderId}” with ${pairedDeviceName(fp, names)}…` });
    try {
      const raw = await window.lanvory
        .syncWithPeer(folderId, adapter, endpoint, fp, pairedDeviceName(fp, names))
        .catch(() => null);
      const parsed = syncResultSchema.safeParse(raw);
      if (parsed.success) {
        onRoute?.({ fingerprint: fp, adapter, endpoint });
        setFolders((prev) => prev?.map((f) => (f.id === folderId ? parsed.data.folder : f)) ?? [parsed.data.folder]);
        const { downloaded, uploaded, conflicts } = parsed.data;
        const summary = `Synced “${folderId}”: ${downloaded} downloaded, ${uploaded} uploaded${conflicts > 0 ? `, ${conflicts} conflict(s) preserved` : ''}.`;
        setListMessage({ tone: 'success', text: summary });
        notify({ category: 'sync', tone: 'success', title: `Folder synced: ${folderId}`, body: summary });
      } else {
        const errText = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : `Unable to sync “${folderId}” with peer.`;
        setListMessage({ tone: 'error', text: errText });
      }
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(folder: SyncFolder) {
    setBusy(true);
    setListMessage(null);
    const updated = folderSchema.safeParse(
      await window.lanvory.setSyncFolderPaused(folder.id, !folder.paused).catch(() => null),
    );
    if (updated.success) {
      setFolders((prev) => prev?.map((f) => (f.id === folder.id ? updated.data : f)) ?? null);
      notify({
        category: 'sync',
        tone: 'info',
        title: updated.data.paused ? `Paused sync for “${folder.id}”.` : `Resumed sync for “${folder.id}”.`,
      });
    }
    setBusy(false);
  }

  async function removeFolder(id: string) {
    setBusy(true);
    setListMessage(null);
    const ok = await window.lanvory.removeSyncFolder(id).catch(() => false);
    if (ok) {
      setFolders((prev) => prev?.filter((f) => f.id !== id) ?? null);
      notify({
        category: 'sync',
        tone: 'info',
        title: `Removed sync folder “${id}”`,
        body: 'Local files preserved.',
      });
    }
    setBusy(false);
  }

  return (
    <section className="network-panel sync-panel tabbed-workspace" aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="sr-only">Sync</h2>
      <WorkspaceTabs name="sync" label="Sync sections" active={tab} onChange={setTab} tabs={[{ id: 'folders', label: 'Registered folders', icon: Folder }, { id: 'add', label: 'Add folder', icon: Plus }]} />
      <WorkspaceTabPanel name="sync" id="folders" active={tab}>
        <section className="operation-card">
          <PanelHeading
            icon={RefreshCw}
            title="Registered folders"
            description="Scan directories locally to compute content digests and detect concurrent changes without overwriting files."
          />
          <SyncBanner feedback={listMessage} />
          {folders === undefined && <p>Loading sync folders…</p>}
          {folders === null && <p role="status">Sync service unavailable.</p>}
          {folders?.length === 0 && <p className="panel-empty">No sync folders configured yet.</p>}
          {!!folders?.length && (
            <ul className="sync-folder-list">
              {folders.map((folder) => (
                <li key={folder.id} className="sync-folder-card">
                  <div className="sync-folder-header">
                    <div className="sync-folder-identity">
                      <span className="sync-folder-icon">
                        <FolderSync size={17} aria-hidden="true" />
                      </span>
                      <div className="sync-folder-title">
                        <strong>{folder.id}</strong>
                        <span className={folder.paused ? 'state-pill' : 'state-pill is-active'}>
                          {folder.paused ? 'Paused' : folder.mode}
                        </span>
                      </div>
                    </div>
                    <div className="sync-folder-actions">
                      <button type="button" className="refresh sync-scan-btn" disabled={busy} onClick={() => void scanFolder(folder.id)}>
                        <RefreshCw size={13} aria-hidden="true" />
                        <span>Scan</span>
                      </button>
                      <button
                        type="button"
                        className="refresh sync-icon-btn"
                        disabled={busy}
                        title={folder.paused ? 'Resume sync' : 'Pause sync'}
                        aria-label={folder.paused ? `Resume ${folder.id}` : `Pause ${folder.id}`}
                        onClick={() => void togglePause(folder)}
                      >
                        {folder.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        className="refresh sync-icon-btn sync-remove-btn"
                        disabled={busy}
                        title="Remove folder"
                        aria-label={`Remove ${folder.id}`}
                        onClick={() => void removeFolder(folder.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="sync-folder-path-row">
                    <Folder size={13} aria-hidden="true" />
                    <code className="sync-folder-path-pill" title={folder.path}>
                      {folder.path}
                    </code>
                  </div>
                  <div className="sync-folder-meta">
                    <span>{folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}</span>
                    <span>·</span>
                    <span>{formatBytes(folder.totalBytes)}</span>
                    {folder.lastScanAt && (
                      <>
                        <span>·</span>
                        <span>Scanned {new Date(folder.lastScanAt).toLocaleTimeString()}</span>
                      </>
                    )}
                  </div>
                  {!!folder.files?.length && (
                    <details className="sync-files-details">
                      <summary>Indexed files ({folder.files.length})</summary>
                      <ul className="sync-files-list">
                        {folder.files.slice(0, 50).map((file) => (
                          <li key={file.relativePath}>
                            <code title={file.relativePath}>{file.relativePath}</code>
                            <span>{formatBytes(file.size)} · v{file.version}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {peers.length > 0 && (() => {
                    const selectedPeer = selectedPeerByFolder[folder.id] ?? '';
                    const isAllowed = Boolean(selectedPeer) && grants.some(
                      (g) => g.fingerprint === selectedPeer && g.capability === 'folder-sync' && g.resource === folder.id && !g.inactive,
                    );
                    return (
                    <form className="sync-peer-form" onSubmit={(event) => void syncWithPeer(event, folder.id)}>
                      <div className="sync-peer-access">
                        <SelectField
                          label="Peer access & sync"
                          name={`syncPeer-${folder.id}`}
                          placeholder="Select paired peer"
                          value={selectedPeer}
                          disabled={busy}
                          onValueChange={(val) => setSelectedPeerByFolder((prev) => ({ ...prev, [folder.id]: val }))}
                          options={peers.map((p) => ({ value: p.fingerprint, label: pairedDeviceName(p.fingerprint, names) }))}
                        />
                        {selectedPeer && (
                          <div className="sync-peer-access-buttons">
                            {!isAllowed ? (
                              <button
                                type="button"
                                className="primary sync-allow-btn"
                                disabled={busy}
                                onClick={() => {
                                  setBusy(true);
                                  void window.lanvory
                                    .setSyncAccess(selectedPeer, folder.id, true)
                                    .then(async (ok) => {
                                      if (ok) {
                                        await refresh();
                                        setListMessage(null);
                                        notify({
                                          category: 'sync',
                                          tone: 'success',
                                          title: `Granted sync access on “${folder.id}” to ${pairedDeviceName(selectedPeer, names)}.`,
                                        });
                                      } else {
                                        setListMessage({ tone: 'error', text: 'Unable to grant folder sync permission.' });
                                      }
                                    })
                                    .finally(() => setBusy(false));
                                }}
                              >
                                Allow
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="refresh sync-revoke-btn"
                                disabled={busy}
                                onClick={() => {
                                  setBusy(true);
                                  void window.lanvory
                                    .setSyncAccess(selectedPeer, folder.id, false)
                                    .then(async (ok) => {
                                      if (ok) {
                                        await refresh();
                                        setListMessage(null);
                                        notify({
                                          category: 'sync',
                                          tone: 'info',
                                          title: `Revoked sync access on “${folder.id}” for ${pairedDeviceName(selectedPeer, names)}.`,
                                        });
                                      } else {
                                        setListMessage({ tone: 'error', text: 'Unable to revoke folder sync permission.' });
                                      }
                                    })
                                    .finally(() => setBusy(false));
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {selectedPeer && isAllowed && (() => {
                        const peerRoute = routes?.[selectedPeer];
                        const useP2P = isP2PRoute(peerRoute);
                        return (
                        <div className="trust-form sync-peer-connect" key={selectedPeer}>
                          {useP2P ? (
                            <div className="paired-device-meta-row">
                              <span className="paired-method-badge is-p2p">Bluetooth + Wi-Fi P2P</span>
                            </div>
                          ) : (
                            <PeerConnectionFields
                              suggestedEndpoint={lanSuggestedEndpoint(peerRoute)}
                              endpointLabel="Peer Lanvory address"
                              adapterLabel="Network adapter"
                              disabled={busy}
                              onReady={(ready) => setConnectionReadyByFolder((prev) => ({ ...prev, [folder.id]: ready }))}
                            />
                          )}
                          <button
                            type="submit"
                            className="primary sync-now-btn"
                            disabled={busy || folder.paused || (!useP2P && !connectionReadyByFolder[folder.id])}
                          >
                            <RefreshCw size={14} aria-hidden="true" />
                            <span>Sync now</span>
                          </button>
                        </div>
                        );
                      })()}
                    </form>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
        </section>
      </WorkspaceTabPanel>
      <WorkspaceTabPanel name="sync" id="add" active={tab}>
        <section className="operation-card operation-highlight">
          <PanelHeading
            icon={FolderSync}
            title="Add sync folder"
            description="Only user-selected folders are indexed with SHA-256 content hashes and version tracking. Symlinks and hidden metadata are excluded."
          />
          <form className="trust-form" onSubmit={(e) => void addFolder(e)}>
            <label>
              Folder ID
              <input name="id" required maxLength={64} placeholder="project-docs" disabled={busy} />
            </label>
            <label>
              Local directory
              <div className="sync-path-row">
                <input
                  type="text"
                  readOnly
                  value={pickedPath}
                  placeholder="No directory selected"
                  aria-label="Selected directory path"
                />
                <button type="button" className="refresh" disabled={busy} onClick={() => void pickDirectory()}>
                  Choose folder
                </button>
              </div>
            </label>
            <SelectField
              label="Sync mode"
              name="mode"
              value={mode}
              disabled={busy}
              options={modeOptions}
              onValueChange={(v) => {
                if (v === 'send-only' || v === 'receive-only' || v === 'bidirectional') setMode(v);
              }}
            />
            <button type="submit" className="primary" disabled={busy || !pickedPath}>
              <Plus size={16} aria-hidden="true" /> Add folder
            </button>
          </form>
          <SyncBanner feedback={addMessage} />
        </section>
      </WorkspaceTabPanel>
    </section>
  );
}

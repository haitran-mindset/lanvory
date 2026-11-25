import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Share2 } from 'lucide-react';
import { z } from 'zod';
import { readPairedNames } from '../../services/paired-names';
import type { PeerRoute } from '../sharing/sharing';
import {
  LiveMountSection,
  mountExportSchema,
  mountRecordSchema,
  type MountExport,
  type MountRecord,
} from './live-mount';

const grantSchema = z.object({
  fingerprint: z.string(),
  capability: z.string(),
  resource: z.string(),
  inactive: z.boolean().optional(),
});

type MountGrant = z.infer<typeof grantSchema>;

export function MountsPanel({
  visible,
  ownerId,
  routes,
  onRoute,
}: {
  visible: boolean;
  ownerId?: string;
  routes?: Record<string, PeerRoute>;
  onRoute?(route: PeerRoute): void;
}) {
  const [tab, setTab] = useState<'remote' | 'shared'>('remote');
  const [mountExports, setMountExports] = useState<MountExport[]>([]);
  const [mountsList, setMountsList] = useState<MountRecord[]>([]);
  const [peers, setPeers] = useState<Array<{ fingerprint: string }>>([]);
  const [grants, setGrants] = useState<MountGrant[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const names = ownerId ? readPairedNames(ownerId) : {};

  async function refresh() {
    setRefreshing(true);
    try {
      const [rawPeers, rawServiceSnap, rawMountExports, rawMounts] = await Promise.all([
        window.lanvory.trustedPeers().catch(() => null),
        window.lanvory.serviceSnapshot().catch(() => null),
        window.lanvory.mountExports().catch(() => null),
        window.lanvory.mounts().catch(() => null),
      ]);
      const parsedPeers = z.array(z.object({ fingerprint: z.string() })).safeParse(rawPeers);
      if (parsedPeers.success) setPeers(parsedPeers.data);
      const parsedGrants = z.object({ grants: z.array(grantSchema) }).safeParse(rawServiceSnap);
      if (parsedGrants.success) setGrants(parsedGrants.data.grants);
      const parsedExports = z.array(mountExportSchema).safeParse(rawMountExports);
      if (parsedExports.success) setMountExports(parsedExports.data);
      const parsedMounts = z.array(mountRecordSchema).safeParse(rawMounts);
      if (parsedMounts.success) setMountsList(parsedMounts.data);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [visible]);

  return (
    <section className="network-panel sync-panel" aria-label="Live Resources">
      <div className="lr-top-bar">
        <div className="lr-tabs" role="tablist" aria-label="Live Resources mode">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'remote'}
            className={`lr-tab ${tab === 'remote' ? 'is-active' : ''}`}
            onClick={() => setTab('remote')}
          >
            <FolderOpen size={15} aria-hidden="true" />
            <span>Remote Folders</span>
            {mountsList.length > 0 && <span className="lr-tab-count">{mountsList.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shared'}
            className={`lr-tab ${tab === 'shared' ? 'is-active' : ''}`}
            onClick={() => setTab('shared')}
          >
            <Share2 size={15} aria-hidden="true" />
            <span>Shared by This Mac</span>
            {mountExports.length > 0 && <span className="lr-tab-count">{mountExports.length}</span>}
          </button>
        </div>

        <button
          type="button"
          className="refresh"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      <LiveMountSection
        mode={tab}
        exportsList={mountExports}
        mountsList={mountsList}
        peers={peers}
        grants={grants}
        names={names}
        routes={routes}
        onRoute={onRoute}
        onRefresh={refresh}
      />
    </section>
  );
}

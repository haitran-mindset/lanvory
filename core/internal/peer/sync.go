package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"net/netip"
	"slices"

	"lanvory.local/core/internal/networking"
	syncengine "lanvory.local/core/internal/sync"
)

func SyncFolder(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, mgr *syncengine.Manager, folderID, peerLabel string,
	inventory func() ([]networking.Interface, error)) (syncengine.SyncResult, error) {
	if !syncengine.ValidID(folderID) {
		return syncengine.SyncResult{}, syncengine.ErrInvalidFolderID
	}
	config, err := clientIdentity(expected, key, syncengine.Protocol)
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	conn, err := dialScoped(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	defer conn.Close()
	return syncengine.RunClientSync(ctx, conn, mgr, folderID, peerLabel)
}

// DiscoverSyncFolders lists sync folders a peer has allowed for this device over LAN.
func DiscoverSyncFolders(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, inventory func() ([]networking.Interface, error)) ([]syncengine.RemoteFolderSummary, error) {
	config, err := clientIdentity(expected, key, syncengine.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialScoped(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return syncengine.DiscoverRemoteFolders(ctx, conn)
}

// DiscoverSyncFoldersLoopback lists sync folders a peer has allowed over Wi-Fi P2P loopback.
func DiscoverSyncFoldersLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, hasEndpoint func(string) bool) ([]syncengine.RemoteFolderSummary, error) {
	config, err := clientIdentity(expected, key, syncengine.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialLoopback(ctx, endpoint, config, hasEndpoint)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return syncengine.DiscoverRemoteFolders(ctx, conn)
}

// SyncFolderLoopback synchronizes a folder over a registered Wi-Fi P2P loopback bridge.
func SyncFolderLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, mgr *syncengine.Manager, folderID, peerLabel string,
	hasEndpoint func(string) bool) (syncengine.SyncResult, error) {
	if !syncengine.ValidID(folderID) {
		return syncengine.SyncResult{}, syncengine.ErrInvalidFolderID
	}
	config, err := clientIdentity(expected, key, syncengine.Protocol)
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	conn, err := dialLoopback(ctx, endpoint, config, hasEndpoint)
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	defer conn.Close()
	return syncengine.RunClientSync(ctx, conn, mgr, folderID, peerLabel)
}

// EnableSync registers the lanvory-sync/1 mTLS handler on an existing Listener.
func (l *Listener) EnableSync(mgr *syncengine.Manager, allowed func(fingerprint, folderID string) bool) {
	if l == nil || mgr == nil || l.trusted == nil {
		return
	}
	l.syncMgr = mgr
	l.syncAllowed = allowed
	baseGet := l.config.GetConfigForClient
	syncCfg := trustedTLS(l.config, syncengine.Protocol, l.trusted)
	l.config.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if slices.Contains(hello.SupportedProtos, syncengine.Protocol) {
			return syncCfg, nil
		}
		if baseGet != nil {
			return baseGet(hello)
		}
		return nil, nil
	}
}

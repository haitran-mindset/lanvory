package peer

import (
	"context"
	"crypto/ed25519"
	"net"
	"net/netip"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/networking"
)

func OpenService(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, id string, inventory func() ([]networking.Interface, error)) (net.Conn, error) {
	if !bridge.ValidID(id) {
		return nil, bridge.ErrNotAvailable
	}
	config, err := clientIdentity(expected, key, bridge.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialResource(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return nil, err
	}
	if err := bridge.Request(ctx, conn, id); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

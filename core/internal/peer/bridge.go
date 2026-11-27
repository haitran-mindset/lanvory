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

// OpenServiceLoopback opens a service tunnel over a registered Wi-Fi P2P loopback bridge.
func OpenServiceLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, id string, hasEndpoint func(string) bool) (net.Conn, error) {
	if !bridge.ValidID(id) {
		return nil, bridge.ErrNotAvailable
	}
	config, err := clientIdentity(expected, key, bridge.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialLoopback(ctx, endpoint, config, hasEndpoint)
	if err != nil {
		return nil, err
	}
	if err := bridge.Request(ctx, conn, id); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

// DiscoverServices lists shared service IDs a peer has granted to this device over LAN.
func DiscoverServices(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, inventory func() ([]networking.Interface, error)) ([]string, error) {
	config, err := clientIdentity(expected, key, bridge.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialResource(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return bridge.DiscoverServices(ctx, conn)
}

// DiscoverServicesLoopback lists shared service IDs a peer has granted over Wi-Fi P2P loopback.
func DiscoverServicesLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, hasEndpoint func(string) bool) ([]string, error) {
	config, err := clientIdentity(expected, key, bridge.Protocol)
	if err != nil {
		return nil, err
	}
	conn, err := dialLoopback(ctx, endpoint, config, hasEndpoint)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return bridge.DiscoverServices(ctx, conn)
}

//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"net"
	"net/netip"
	"time"

	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/networking"
)

func SendFile(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint, key ed25519.PrivateKey, path string,
	inventory func() ([]networking.Interface, error), trusted func() (bool, error), tracker *drop.Tracker) error {
	interfaces, err := inventory()
	if err != nil {
		return err
	}
	sourceAddr, sourceIndex := endpointScope(interfaces, adapter, endpoint)
	if sourceIndex == 0 {
		return ErrPeerScope
	}
	inScope := func() bool {
		current, err := inventory()
		if err != nil {
			return false
		}
		address, index := endpointScope(current, adapter, endpoint)
		return index == sourceIndex && address == sourceAddr
	}
	return sendFile(ctx, expected, key, path, inScope, trusted, tracker, func(config *tls.Config) (net.Conn, error) {
		return dialResource(ctx, adapter, endpoint, inventory, config)
	})
}

// dialLoopback dials a local 127.0.0.1 Wi-Fi P2P bridge endpoint registered by the nearby helper.
func dialLoopback(ctx context.Context, endpoint netip.AddrPort, config *tls.Config, hasEndpoint func(string) bool) (net.Conn, error) {
	if endpoint.Addr() != netip.MustParseAddr("127.0.0.1") || endpoint.Port() == 0 ||
		hasEndpoint == nil || !hasEndpoint(endpoint.String()) {
		return nil, ErrPeerScope
	}
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	dialer := tls.Dialer{Config: config}
	return dialer.DialContext(dialCtx, "tcp4", endpoint.String())
}

// SendFileLoopback uses a bridge endpoint registered by the local Wi-Fi P2P helper.
func SendFileLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint, key ed25519.PrivateKey, path string,
	hasEndpoint func(string) bool, trusted func() (bool, error), tracker *drop.Tracker) error {
	if endpoint.Addr() != netip.MustParseAddr("127.0.0.1") || endpoint.Port() == 0 ||
		hasEndpoint == nil || !hasEndpoint(endpoint.String()) {
		return ErrPeerScope
	}
	inScope := func() bool { return hasEndpoint(endpoint.String()) }
	return sendFile(ctx, expected, key, path, inScope, trusted, tracker, func(config *tls.Config) (net.Conn, error) {
		return dialLoopback(ctx, endpoint, config, hasEndpoint)
	})
}

func sendFile(ctx context.Context, expected Fingerprint, key ed25519.PrivateKey, path string,
	inScope func() bool, trusted func() (bool, error), tracker *drop.Tracker,
	dial func(*tls.Config) (net.Conn, error)) (result error) {
	if allowed, err := trusted(); err != nil || !allowed {
		if err != nil {
			return err
		}
		return ErrPeerIdentity
	}
	source, err := drop.OpenSource(ctx, path)
	if err != nil {
		return err
	}
	defer source.Close()
	progress := tracker.Start("", "outgoing", expected.String(), source.Manifest)
	defer func() { progress.Finish(result) }()
	if allowed, err := trusted(); err != nil || !allowed {
		if err != nil {
			return err
		}
		return ErrPeerIdentity
	}
	config, err := clientIdentity(expected, key, drop.Protocol)
	if err != nil {
		return err
	}
	if !inScope() {
		return ErrPeerScope
	}
	conn, err := dial(config)
	if err != nil {
		return err
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			allowed, err := trusted()
			if err != nil || !allowed || !inScope() {
				cancel()
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	err = source.SendTracked(ctx, conn, progress)
	if err != nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	cancel()
	<-done
	return err
}

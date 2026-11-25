//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"net/netip"
	"time"

	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/networking"
)

func SendFile(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint, key ed25519.PrivateKey, path string,
	inventory func() ([]networking.Interface, error), trusted func() (bool, error), tracker *drop.Tracker) (result error) {
	interfaces, err := inventory()
	if err != nil {
		return err
	}
	sourceAddr, sourceIndex := endpointScope(interfaces, adapter, endpoint)
	if sourceIndex == 0 {
		return ErrPeerScope
	}
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
	conn, err := dialResource(ctx, adapter, endpoint, inventory, config)
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
			current, scopeErr := inventory()
			address, index := endpointScope(current, adapter, endpoint)
			if err != nil || !allowed || scopeErr != nil || index != sourceIndex || address != sourceAddr {
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

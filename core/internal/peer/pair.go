package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"net"
	"net/netip"
	"slices"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
)

// The pairing ALPN accepts a valid Ed25519 certificate solely for pending
// consent. Its connection has no access to the trusted application protocols.
func enablePairingTLS(primary *tls.Config) *tls.Config {
	pairingTLS := primary.Clone()
	pairingTLS.NextProtos = []string{pairing.Protocol}
	pairingTLS.GetConfigForClient = nil
	pairingTLS.ClientAuth = tls.RequireAnyClientCert
	pairingTLS.VerifyConnection = func(state tls.ConnectionState) error {
		_, err := certificateFingerprint(state, pairing.Protocol)
		return err
	}
	result := primary.Clone()
	result.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if slices.Contains(hello.SupportedProtos, pairing.Protocol) {
			return pairingTLS, nil
		}
		if primary.GetConfigForClient != nil {
			return primary.GetConfigForClient(hello)
		}
		return nil, nil
	}
	return result
}

func ExchangePairing(ctx context.Context, conn *tls.Conn, manager *pairing.Manager, direction string, scope func() bool) error {
	state := conn.ConnectionState()
	fingerprint, err := certificateFingerprint(state, pairing.Protocol)
	if err != nil {
		return err
	}
	data, err := state.ExportKeyingMaterial(pairing.ExporterLabel, nil, 16)
	if err != nil {
		return err
	}
	source := conn.RemoteAddr().String()
	if addr, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
		source = addr.AddrPort().Addr().Unmap().String()
	}
	return manager.Exchange(ctx, conn, direction, fingerprint.String(), source, [16]byte(data), scope)
}

func Pair(ctx context.Context, adapter string, endpoint netip.AddrPort, pin Fingerprint, key ed25519.PrivateKey, manager *pairing.Manager,
	inventory func() ([]networking.Interface, error)) error {
	interfaces, err := inventory()
	if err != nil {
		return err
	}
	source, index := endpointScope(interfaces, adapter, endpoint)
	if index == 0 {
		return ErrPeerScope
	}
	config, err := clientIdentity(pin, key, pairing.Protocol)
	if err != nil {
		return err
	}
	conn, err := dialScoped(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return err
	}
	defer conn.NetConn().Close()
	return ExchangePairing(ctx, conn, manager, "outgoing", func() bool {
		current, err := inventory()
		if err != nil {
			return false
		}
		currentSource, currentIndex := endpointScope(current, adapter, endpoint)
		return currentSource == source && currentIndex == index
	})
}

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"errors"
	"net"
	"net/netip"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/pairing"
)

// ListenLoopback opens a loopback-only mTLS listener used exclusively as the
// local target for the OS-level Wi-Fi P2P (AWDL) bridge helper.
func ListenLoopback(
	ctx context.Context,
	key ed25519.PrivateKey,
	trusted func(string) (bool, error),
	receiver *drop.Receiver,
	services bridge.Lookup,
	pairs *pairing.Manager,
) (*Listener, error) {
	config, err := identityTLS(key)
	if err != nil {
		return nil, err
	}
	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	config = mutualServer(config, trusted, receiver != nil, services != nil)
	if pairs != nil {
		config = enablePairingTLS(config)
	}
	return &Listener{
		Listener: listener,
		source:   netip.MustParseAddr("127.0.0.1"),
		name:     "p2p",
		index:    0,
		config:   config,
		trusted:  trusted,
		receiver: receiver,
		services: services,
		pairs:    pairs,
	}, nil
}

// ProbeP2PIdentity connects to an active loopback P2P bridge endpoint, performs a
// TLS 1.3 handshake, and returns the peer's authenticated Ed25519 fingerprint.
func ProbeP2PIdentity(ctx context.Context, endpoint netip.AddrPort) (Fingerprint, error) {
	if !endpoint.Addr().IsLoopback() || endpoint.Port() == 0 {
		return Fingerprint{}, ErrPeerScope
	}
	dialCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	var d net.Dialer
	raw, err := d.DialContext(dialCtx, "tcp4", endpoint.String())
	if err != nil {
		return Fingerprint{}, err
	}
	defer raw.Close()
	tlsConn := tls.Client(raw, &tls.Config{
		MinVersion:             tls.VersionTLS13,
		NextProtos:             []string{protocol},
		SessionTicketsDisabled: true,
		InsecureSkipVerify:     true,
	})
	if err := tlsConn.HandshakeContext(dialCtx); err != nil {
		return Fingerprint{}, err
	}
	state := tlsConn.ConnectionState()
	if state.NegotiatedProtocol != protocol || len(state.PeerCertificates) != 1 {
		return Fingerprint{}, ErrPeerIdentity
	}
	cert := state.PeerCertificates[0]
	pub, ok := cert.PublicKey.(ed25519.PublicKey)
	now := time.Now()
	if !ok || now.Before(cert.NotBefore) || now.After(cert.NotAfter) {
		return Fingerprint{}, ErrPeerIdentity
	}
	return Fingerprint(sha256.Sum256(pub)), nil
}

// PairLoopback initiates SAS pairing over an active loopback P2P bridge endpoint.
func PairLoopback(
	ctx context.Context,
	endpoint netip.AddrPort,
	pin Fingerprint,
	key ed25519.PrivateKey,
	manager *pairing.Manager,
) error {
	if !endpoint.Addr().IsLoopback() || endpoint.Port() == 0 {
		return ErrPeerScope
	}
	if manager == nil {
		return errors.New("pairing manager unavailable")
	}
	config, err := clientIdentity(pin, key, pairing.Protocol)
	if err != nil {
		return err
	}
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var d net.Dialer
	raw, err := d.DialContext(dialCtx, "tcp4", endpoint.String())
	if err != nil {
		return err
	}
	conn := tls.Client(raw, config)
	if err := conn.HandshakeContext(dialCtx); err != nil {
		raw.Close()
		return err
	}
	defer conn.Close()
	return ExchangePairing(ctx, conn, manager, "outgoing", func() bool { return true })
}

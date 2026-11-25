package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"

	"lanvory.local/core/internal/networking"
)

func TestIdentityHandshake(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config, err := identityTLS(private)
	if err != nil {
		t.Fatal(err)
	}

	expected := Fingerprint(sha256.Sum256(public))
	mismatch := expected
	mismatch[0] ^= 1
	noALPN := config.Clone()
	noALPN.NextProtos = nil
	for _, tc := range []struct {
		name      string
		server    *tls.Config
		pin       Fingerprint
		wantError bool
	}{
		{"matches", config, expected, false},
		{"mismatches", config, mismatch, true},
		{"missing ALPN", noALPN, expected, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			serverConn, clientConn := net.Pipe()
			defer serverConn.Close()
			defer clientConn.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			server := make(chan error, 1)
			go func() { server <- tls.Server(serverConn, tc.server).HandshakeContext(ctx) }()
			client := tls.Client(clientConn, pinnedTLS(tc.pin, protocol))
			err := client.HandshakeContext(ctx)
			if tc.wantError {
				if !errors.Is(err, ErrPeerIdentity) {
					t.Fatalf("handshake error = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := <-server; err != nil {
				t.Fatal(err)
			}
			if state := client.ConnectionState(); state.Version != tls.VersionTLS13 || state.NegotiatedProtocol != protocol {
				t.Fatal("unexpected negotiated TLS version or protocol")
			}
		})
	}
}

func TestDeniedBind(t *testing.T) {
	for _, bind := range []string{"0.0.0.0:0", "127.0.0.1:0", "192.168.2.4:0", "192.168.3.4:0"} {
		t.Run(bind, func(t *testing.T) {
			listener, err := Listen(context.Background(), "en0", netip.MustParseAddrPort(bind), nil, func() ([]networking.Interface, error) {
				return []networking.Interface{
					{Name: "en0", Index: 2, Eligible: true, Addresses: []string{"192.168.2.4/24"}},
				}, nil
			}, nil, nil, nil, nil)
			if err == nil {
				listener.Close()
				t.Fatal("opened a listener outside an approved scope")
			}
		})
	}
}

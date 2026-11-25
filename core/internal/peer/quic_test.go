package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"net"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/quic-go/quic-go"
)

func testQUICSocket(t *testing.T) *net.UDPConn {
	t.Helper()
	socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { socket.Close() })
	return socket
}

func TestQUICPinnedMutualVerificationWithConcurrentStreams(t *testing.T) {
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	expectedClient := Fingerprint(sha256.Sum256(clientPublic))
	trusted := func(pin string) (bool, error) { return pin == expectedClient.String(), nil }
	identity, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	serverSocket := testQUICSocket(t)
	clientSocket := testQUICSocket(t)
	serverEndpoint := serverSocket.LocalAddr().(*net.UDPAddr).AddrPort()
	clientEndpoint := clientSocket.LocalAddr().(*net.UDPAddr).AddrPort()
	serverTransport := quic.Transport{Conn: scopedPackets{PacketConn: serverSocket, permitted: func(endpoint netip.AddrPort) bool { return endpoint == clientEndpoint }}}
	defer serverTransport.Close()
	server, err := serverTransport.Listen(trustedTLS(identity, quicTrustedProtocol, trusted), quicConfig(true))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	transport := quic.Transport{Conn: scopedPackets{PacketConn: clientSocket, permitted: func(endpoint netip.AddrPort) bool { return endpoint == serverEndpoint }}}
	defer transport.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := server.Accept(ctx)
		if err != nil {
			return
		}
		serveQUICStreams(ctx, conn, trusted, func() bool { return true }, nil, nil)
	}()
	wrong := Fingerprint(sha256.Sum256(serverPublic))
	wrong[0] ^= 1
	wrongConfig, err := clientIdentity(wrong, clientKey, quicTrustedProtocol)
	if err != nil {
		t.Fatal(err)
	}
	if conn, err := dialQUIC(ctx, &transport, serverEndpoint, wrongConfig); !errors.Is(err, ErrPeerIdentity) {
		if conn != nil {
			conn.CloseWithError(0, "unexpected handshake")
		}
		t.Fatalf("wrong fingerprint error = %v", err)
	}

	_, untrustedKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	untrustedConfig, err := clientIdentity(sha256.Sum256(serverPublic), untrustedKey, quicTrustedProtocol)
	if err != nil {
		t.Fatal(err)
	}
	untrusted, dialErr := dialQUIC(ctx, &transport, serverEndpoint, untrustedConfig)
	if dialErr == nil {
		dialErr = verifyQUICStream(ctx, untrusted)
		untrusted.CloseWithError(0, "test done")
	}
	if dialErr == nil || errors.Is(dialErr, ErrQUICUnreachable) {
		t.Fatalf("untrusted client result = %v", dialErr)
	}

	config, err := clientIdentity(sha256.Sum256(serverPublic), clientKey, quicTrustedProtocol)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := dialQUIC(ctx, &transport, serverEndpoint, config)
	if err != nil {
		t.Fatal(err)
	}
	state := conn.ConnectionState()
	if state.Used0RTT || state.TLS.NegotiatedProtocol != quicTrustedProtocol {
		t.Fatal("unexpected QUIC handshake")
	}
	outcomes := make(chan error, 6)
	var streams sync.WaitGroup
	for range cap(outcomes) {
		streams.Go(func() { outcomes <- verifyQUICStream(ctx, conn) })
	}
	streams.Wait()
	close(outcomes)
	for err := range outcomes {
		if err != nil {
			t.Fatal(err)
		}
	}
	conn.CloseWithError(0, "test done")
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("QUIC streams did not stop")
	}
}

func TestSilentUDPEndpointProducesQUICFallbackError(t *testing.T) {
	silent := testQUICSocket(t)
	source := testQUICSocket(t)
	transport := quic.Transport{Conn: source}
	defer transport.Close()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config, err := clientIdentity(Fingerprint{}, key, quicTrustedProtocol)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	endpoint := silent.LocalAddr().(*net.UDPAddr).AddrPort()
	if _, err := dialQUIC(ctx, &transport, endpoint, config); !errors.Is(err, ErrQUICUnreachable) {
		t.Fatalf("silent QUIC endpoint error = %v", err)
	}
}

func TestScopedPacketsRejectUnexpectedEndpoints(t *testing.T) {
	socket, allowed, denied := testQUICSocket(t), testQUICSocket(t), testQUICSocket(t)
	expected := allowed.LocalAddr().(*net.UDPAddr).AddrPort()
	scope := scopedPackets{PacketConn: socket, permitted: func(endpoint netip.AddrPort) bool { return endpoint == expected }}
	if _, err := scope.WriteTo([]byte("denied"), denied.LocalAddr()); !errors.Is(err, ErrPeerScope) {
		t.Fatalf("unexpected destination error = %v", err)
	}
	if _, err := denied.WriteTo([]byte("denied"), socket.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	if _, err := allowed.WriteTo([]byte("allowed"), socket.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	if err := scope.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var data [16]byte
	n, addr, err := scope.ReadFrom(data[:])
	if err != nil || addr.String() != allowed.LocalAddr().String() || string(data[:n]) != "allowed" {
		t.Fatalf("received %q from %v, error %v", data[:n], addr, err)
	}
}

//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/quic-go/quic-go"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/drop"
)

func resourceQUIC(t *testing.T, ctx context.Context, protocol string,
	receive func(context.Context, *quic.Conn, func(string) (bool, error))) *quicStreamConn {
	t.Helper()
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pin := Fingerprint(sha256.Sum256(clientPublic)).String()
	trust := func(actual string) (bool, error) { return actual == pin, nil }
	identity, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	serverUDP, clientUDP := testQUICSocket(t), testQUICSocket(t)
	serverTransport := quic.Transport{Conn: serverUDP}
	t.Cleanup(func() { serverTransport.Close() })
	listener, err := serverTransport.Listen(trustedTLS(identity, protocol, trust), quicConfig(true))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept(ctx)
		if err == nil {
			receive(ctx, conn, trust)
		}
	}()
	t.Cleanup(func() { <-done })
	clientTransport := quic.Transport{Conn: clientUDP}
	t.Cleanup(func() { clientTransport.Close() })
	config, err := clientIdentity(sha256.Sum256(serverPublic), clientKey, protocol)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := serverUDP.LocalAddr().(*net.UDPAddr).AddrPort()
	connection, err := dialQUIC(ctx, &clientTransport, endpoint, config)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := connection.OpenStreamSync(ctx)
	if err != nil {
		connection.CloseWithError(1, "test failed")
		t.Fatal(err)
	}
	wire := &quicStreamConn{Stream: stream, connection: connection, closeSession: func() { connection.CloseWithError(0, "test finished") }}
	t.Cleanup(func() { wire.Close() })
	return wire
}

func TestQUICDropChecksInboxApproval(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	receiverDir := t.TempDir()
	receiver := drop.NewReceiver(receiverDir, func(string) (bool, error) { return true, nil }, nil)
	wire := resourceQUIC(t, ctx, drop.Protocol, func(ctx context.Context, conn *quic.Conn, trust func(string) (bool, error)) {
		serveQUICStreams(ctx, conn, trust, func() bool { return true }, receiver, nil)
	})
	sender := filepath.Join(t.TempDir(), "quic-test.txt")
	if err := os.WriteFile(sender, []byte("from QUIC"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := drop.OpenSource(ctx, sender)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	result := make(chan error, 1)
	go func() { result <- source.SendStream(ctx, wire) }()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			t.Fatal("no pending QUIC offer")
		case err := <-result:
			t.Fatalf("send finished before approval: %v", err)
		case <-tick.C:
			if offers := receiver.Pending(); len(offers) == 1 {
				if err := receiver.Decide(offers[0].ID, true); err != nil {
					t.Fatal(err)
				}
				if err := <-result; err != nil {
					t.Fatal(err)
				}
				contents, err := os.ReadFile(filepath.Join(receiverDir, drop.Inbox, "quic-test.txt"))
				if err != nil || string(contents) != "from QUIC" {
					t.Fatalf("inbox contents = %q, %v", contents, err)
				}
				return
			}
		}
	}
}

func TestQUICBridgeRelaysThenRevokes(t *testing.T) {
	var granted atomic.Bool
	granted.Store(true)
	testQUICBridgeGrantEnds(t, func(target netip.AddrPort) (bridge.Lookup, func()) {
		return func(_ string, id string) (bridge.Service, error) {
			if id != "echo" || !granted.Load() {
				return bridge.Service{}, bridge.ErrNotAvailable
			}
			return bridge.Service{ID: id, Target: target}, nil
		}, func() { granted.Store(false) }
	})
}

func testQUICBridgeGrantEnds(t *testing.T, configure func(netip.AddrPort) (bridge.Lookup, func())) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ready := make(chan net.Conn, 1)
	go func() {
		if backend, err := listener.Accept(); err == nil {
			ready <- backend
		}
	}()
	target := netip.MustParseAddrPort(listener.Addr().String())
	authorized, endGrant := configure(target)
	wire := resourceQUIC(t, ctx, bridge.Protocol, func(ctx context.Context, conn *quic.Conn, trust func(string) (bool, error)) {
		lookup := func(pin, id string) (bridge.Service, error) {
			if approved, err := trust(pin); err != nil || !approved {
				return bridge.Service{}, bridge.ErrNotAvailable
			}
			return authorized(pin, id)
		}
		serveQUICStreams(ctx, conn, trust, func() bool { return true }, nil, lookup)
	})
	if err := bridge.Request(ctx, wire, "echo"); err != nil {
		t.Fatal(err)
	}
	var backend net.Conn
	select {
	case backend = <-ready:
	case <-ctx.Done():
		t.Fatal("bridge did not dial registered target")
	}
	defer backend.Close()
	deadline, _ := ctx.Deadline()
	backend.SetDeadline(deadline)
	wire.SetDeadline(deadline)
	if _, err := wire.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	var buf [5]byte
	if _, err := io.ReadFull(backend, buf[:]); err != nil || string(buf[:]) != "hello" {
		t.Fatalf("backend read %q, %v", buf, err)
	}
	if _, err := backend.Write([]byte("world")); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(wire, buf[:]); err != nil || string(buf[:]) != "world" {
		t.Fatalf("peer read %q, %v", buf, err)
	}
	endGrant()
	_, err = wire.Read(buf[:])
	var networkError net.Error
	if err == nil || ctx.Err() != nil || (errors.As(err, &networkError) && networkError.Timeout()) {
		t.Fatalf("bridge did not close when access ended: %v", err)
	}
}

//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"io"
	"net"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"lanvory.local/core/internal/bridge"
)

func TestMutualBridgeRelaysRegisteredServiceAndStopsOnRevocation(t *testing.T) {
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	clientPin := Fingerprint(sha256.Sum256(clientPublic)).String()

	backend, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := backend.Accept()
		if err == nil {
			accepted <- conn
		}
	}()
	service := bridge.Service{ID: "echo", Target: netip.MustParseAddrPort(backend.Addr().String())}
	var allowed atomic.Bool
	trust := func(pin string) (bool, error) { return pin == clientPin, nil }
	lookup := func(pin, id string) (bridge.Service, error) {
		if pin != clientPin || id != service.ID || !allowed.Load() {
			return bridge.Service{}, bridge.ErrNotAvailable
		}
		return service, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientConfig, err := clientIdentity(sha256.Sum256(serverPublic), clientKey, bridge.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	for _, permit := range []bool{false, true} {
		allowed.Store(permit)
		serverRaw, clientRaw := net.Pipe()
		defer serverRaw.Close()
		defer clientRaw.Close()
		until, _ := ctx.Deadline()
		if err := clientRaw.SetDeadline(until); err != nil {
			t.Fatal(err)
		}
		server := tls.Server(serverRaw, mutualServer(config, trust, false, true))
		client := tls.Client(clientRaw, clientConfig)
		done := make(chan error, 1)
		go func() {
			defer serverRaw.Close()
			if err := server.HandshakeContext(ctx); err != nil {
				done <- err
				return
			}
			pin, err := certificateFingerprint(server.ConnectionState(), bridge.Protocol)
			if err != nil {
				done <- err
				return
			}
			done <- bridge.Serve(ctx, server, pin.String(), lookup, func() bool { return true })
		}()
		if err := client.HandshakeContext(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := client.Write([]byte{4, 'e', 'c', 'h', 'o'}); err != nil {
			t.Fatal(err)
		}
		var status [1]byte
		_, err := io.ReadFull(client, status[:])
		if !permit {
			if err == nil || <-done != bridge.ErrNotAvailable {
				t.Fatal("unauthorized service request succeeded")
			}
			continue
		}
		if err != nil || status[0] != bridge.Ready {
			t.Fatalf("missing bridge acknowledgement: %v", err)
		}
		var conn net.Conn
		select {
		case conn = <-accepted:
		case <-ctx.Done():
			t.Fatal("service connection missing")
		}
		defer conn.Close()
		if err := conn.SetDeadline(until); err != nil {
			t.Fatal(err)
		}
		if _, err := client.Write([]byte("hello")); err != nil {
			t.Fatal(err)
		}
		var request [5]byte
		if _, err := io.ReadFull(conn, request[:]); err != nil || string(request[:]) != "hello" {
			t.Fatalf("backend request = %q, %v", request, err)
		}
		if _, err := conn.Write([]byte("world")); err != nil {
			t.Fatal(err)
		}
		var response [5]byte
		if _, err := io.ReadFull(client, response[:]); err != nil || string(response[:]) != "world" {
			t.Fatalf("tunneled response = %q, %v", response, err)
		}
		allowed.Store(false)
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("revoked session stayed open")
		}
		if _, err := io.ReadFull(client, status[:]); err == nil {
			t.Fatal("revoked session still returned data")
		}
	}
}

func TestLoopbackTunnelRelaysAuthenticatedServiceAndCancels(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	backend, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	backendDone := make(chan error, 1)
	go func() {
		socket, err := backend.Accept()
		if err == nil {
			defer socket.Close()
			var frame [5]byte
			_, err = io.ReadFull(socket, frame[:])
			if err == nil {
				_, err = socket.Write(frame[:])
			}
			if err == nil {
				_, err = io.Copy(io.Discard, socket)
			}
		}
		backendDone <- err
	}()

	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	clientFingerprint := Fingerprint(sha256.Sum256(clientPublic)).String()
	trust := func(pin string) (bool, error) { return pin == clientFingerprint, nil }
	serverConfig := mutualServer(identity, trust, false, true)
	clientConfig, err := clientIdentity(sha256.Sum256(serverPublic), clientKey, bridge.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	service := bridge.Service{ID: "echo", Target: netip.MustParseAddrPort(backend.Addr().String())}
	lookup := func(pin, id string) (bridge.Service, error) {
		if pin != clientFingerprint || id != service.ID {
			return bridge.Service{}, bridge.ErrNotAvailable
		}
		return service, nil
	}
	remoteDone := make(chan error, 1)
	connect := func(ctx context.Context) (net.Conn, error) {
		serverRaw, clientRaw := net.Pipe()
		server, client := tls.Server(serverRaw, serverConfig), tls.Client(clientRaw, clientConfig)
		go func() {
			defer serverRaw.Close()
			if err := server.HandshakeContext(ctx); err != nil {
				remoteDone <- err
				return
			}
			fp, err := certificateFingerprint(server.ConnectionState(), bridge.Protocol)
			if err != nil {
				remoteDone <- err
				return
			}
			remoteDone <- bridge.Serve(ctx, server, fp.String(), lookup, func() bool { return true })
		}()
		if err := client.HandshakeContext(ctx); err != nil {
			clientRaw.Close()
			return nil, err
		}
		if err := bridge.Request(ctx, client, service.ID); err != nil {
			clientRaw.Close()
			return nil, err
		}
		return client, nil
	}

	var allowed atomic.Bool
	allowed.Store(true)
	tunnels := bridge.NewTunnels()
	defer tunnels.Close()
	if _, err := tunnels.Open(ctx, netip.MustParseAddrPort("0.0.0.0:0"), service.ID, connect, allowed.Load); err == nil {
		t.Fatal("tunnel accepted a wildcard bind")
	}
	tunnel, err := tunnels.Open(ctx, netip.MustParseAddrPort("127.0.0.1:0"), service.ID, connect, allowed.Load)
	if err != nil {
		t.Fatal(err)
	}
	if !tunnel.Bind.Addr().IsLoopback() || tunnel.Bind.Port() == 0 || len(tunnels.List()) != 1 {
		t.Fatalf("tunnel = %+v", tunnel)
	}
	socket, err := (&net.Dialer{}).DialContext(ctx, "tcp", tunnel.Bind.String())
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	deadline, _ := ctx.Deadline()
	if err := socket.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	if _, err := socket.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	var response [5]byte
	if _, err := io.ReadFull(socket, response[:]); err != nil || string(response[:]) != "hello" {
		t.Fatalf("local tunnel response=%q,%v", response, err)
	}
	if active := tunnels.List(); len(active) != 1 || active[0].Connections != 1 {
		t.Fatalf("active connections = %+v", active)
	}
	allowed.Store(false)
	if _, err := socket.Read(response[:]); err == nil || ctx.Err() != nil {
		t.Fatalf("local access was not interrupted on revocation: %v", err)
	}
	select {
	case <-remoteDone:
	case <-ctx.Done():
		t.Fatal("remote session stayed open")
	}
	select {
	case <-backendDone:
	case <-ctx.Done():
		t.Fatal("target session stayed open")
	}
	for len(tunnels.List()) != 0 {
		select {
		case <-ctx.Done():
			t.Fatal("revoked listener remained registered")
		case <-time.After(10 * time.Millisecond):
		}
	}
	allowed.Store(true)
	another, err := tunnels.Open(ctx, tunnel.Bind, service.ID, connect, allowed.Load)
	if err != nil {
		t.Fatal(err)
	}
	if err := tunnels.Stop(ctx, another.ID); err != nil {
		t.Fatal(err)
	}
	if len(tunnels.List()) != 0 {
		t.Fatal("stopped tunnel stayed registered")
	}
}

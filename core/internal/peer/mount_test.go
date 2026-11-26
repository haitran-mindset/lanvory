package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/quic-go/quic-go"

	"lanvory.local/core/internal/mount"
)

func TestMountSessionRangeAndWriteOverMTLS(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hostPublic, hostKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostPin := Fingerprint(sha256.Sum256(hostPublic))
	clientPin := Fingerprint(sha256.Sum256(clientPublic))

	root := t.TempDir()
	sample := "0123456789abcdef-lanvory-live-mount-payload"
	if err := os.WriteFile(filepath.Join(root, "video.bin"), []byte(sample), 0o600); err != nil {
		t.Fatal(err)
	}

	reg := mount.NewRegistry()
	if _, err := reg.Add("media", root, false); err != nil {
		t.Fatal(err)
	}

	baseConfig, err := identityTLS(hostKey)
	if err != nil {
		t.Fatal(err)
	}
	l := &Listener{config: baseConfig, trusted: func(fp string) (bool, error) {
		return fp == clientPin.String(), nil
	}}
	l.EnableMount(reg, func(fp, mountID string) bool {
		return fp == clientPin.String() && mountID == "media"
	})

	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	go func() {
		for {
			raw, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				srv := tls.Server(c, l.config)
				if err := srv.HandshakeContext(ctx); err != nil {
					t.Logf("server handshake err: %v", err)
					return
				}
				pin, err := certificateFingerprint(srv.ConnectionState(), mount.Protocol)
				if err != nil {
					t.Logf("server cert fp err: %v", err)
					return
				}
				_ = serveMountConn(ctx, srv, pin.String(), l.mountReg, l.mountAllowed, func() bool { return true })
			}(raw)
		}
	}()

	clientTLS, err := clientIdentity(hostPin, clientKey, mount.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	dialFn := func(dialCtx context.Context) (net.Conn, error) {
		var d net.Dialer
		raw, err := d.DialContext(dialCtx, "tcp4", ln.Addr().String())
		if err != nil {
			return nil, err
		}
		conn := tls.Client(raw, clientTLS)
		if err := conn.HandshakeContext(dialCtx); err != nil {
			raw.Close()
			return nil, err
		}
		return conn, nil
	}

	// 0. Test Resource Discovery over mTLS (returns only authorized resources).
	discovered, err := discoverResources(ctx, dialFn)
	if err != nil {
		t.Fatal(err)
	}
	if len(discovered) != 1 || discovered[0].ID != "media" {
		t.Fatalf("unexpected discovered resources: %+v", discovered)
	}

	session, err := startMountSession(ctx, "media", "127.0.0.1:0", dialFn)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	// 0b. Test Resource Event Engine polling + reconciliation over mTLS.
	seq, events, err := session.PollEvents(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if seq == 0 || len(events) == 0 || events[0].Type != "resource.created" {
		t.Fatalf("unexpected initial events seq=%d events=%+v", seq, events)
	}

	// 1. Test HTTP Range request (206 Partial Content) over mTLS.
	req, err := http.NewRequest(http.MethodGet, session.URL+"video.bin", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=17-35")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d (%s)", resp.StatusCode, string(body))
	}
	if string(body) != "lanvory-live-mount-" {
		t.Fatalf("unexpected range body %q", string(body))
	}

	// 2. Test WebDAV PUT writeback over mTLS.
	putReq, err := http.NewRequest(http.MethodPut, session.URL+"notes.txt", strings.NewReader("edited remotely"))
	if err != nil {
		t.Fatal(err)
	}
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatal(err)
	}
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusCreated && putResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 201/204, got %d", putResp.StatusCode)
	}
	got, err := os.ReadFile(filepath.Join(root, "notes.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "edited remotely" {
		t.Fatalf("unexpected written file %q", string(got))
	}
}

func TestDiscoverAndReadMountOverQUIC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	hostPublic, hostKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostPin := Fingerprint(sha256.Sum256(hostPublic))
	clientPin := Fingerprint(sha256.Sum256(clientPublic))

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello over quic"), 0o600); err != nil {
		t.Fatal(err)
	}
	reg := mount.NewRegistry()
	if _, err := reg.Add("docs", root, false); err != nil {
		t.Fatal(err)
	}

	trusted := func(pin string) (bool, error) { return pin == clientPin.String(), nil }
	mountAllowed := func(pin, id string) bool { return pin == clientPin.String() && id == "docs" }

	identity, err := identityTLS(hostKey)
	if err != nil {
		t.Fatal(err)
	}
	serverSock := testQUICSocket(t)
	clientSock := testQUICSocket(t)
	serverAddr := serverSock.LocalAddr().(*net.UDPAddr).AddrPort()

	serverTr := &quic.Transport{Conn: serverSock, VerifySourceAddress: func(net.Addr) bool { return true }}
	defer serverTr.Close()
	ln, err := serverTr.Listen(trustedProtocolsTLS(identity, []string{mount.Protocol}, trusted), quicConfig(true))
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	go func() {
		conn, err := ln.Accept(ctx)
		if err != nil {
			return
		}
		defer conn.CloseWithError(0, "done")
		serveQUICStreamsWithMount(ctx, conn, trusted, func() bool { return true }, nil, nil, reg, mountAllowed)
	}()

	clientTLS, err := clientIdentity(hostPin, clientKey, mount.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	clientTr := &quic.Transport{Conn: clientSock}
	defer clientTr.Close()
	qconn, err := clientTr.Dial(ctx, &net.UDPAddr{IP: serverAddr.Addr().AsSlice(), Port: int(serverAddr.Port())}, clientTLS, quicConfig(false))
	if err != nil {
		t.Fatal(err)
	}
	defer qconn.CloseWithError(0, "done")

	dialFn := func(dialCtx context.Context) (net.Conn, error) {
		stream, err := qconn.OpenStreamSync(dialCtx)
		if err != nil {
			return nil, err
		}
		return &quicStreamConn{Stream: stream, connection: qconn}, nil
	}

	discovered, err := discoverResources(ctx, dialFn)
	if err != nil {
		t.Fatalf("discoverResources over QUIC failed: %v", err)
	}
	if len(discovered) != 1 || discovered[0].ID != "docs" {
		t.Fatalf("unexpected discovered resources over QUIC: %+v", discovered)
	}

	session, err := startMountSession(ctx, "docs", "127.0.0.1:0", dialFn)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	resp, err := http.Get(session.URL + "hello.txt")
	if err != nil {
		t.Fatalf("GET over QUIC mount failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "hello over quic" {
		t.Fatalf("unexpected QUIC mount response status=%d body=%q", resp.StatusCode, string(body))
	}
}

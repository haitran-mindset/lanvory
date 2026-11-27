//go:build (darwin || linux) && cgo

package local

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lanvory.local/core/internal/screenshare"
	"lanvory.local/core/internal/storage"
)

func TestScreenMediaWorkerReusesDaemonSocket(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "lanvory-media-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	listener, cleanup, err := Listen(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	var connections atomic.Int32
	server := &http.Server{
		ConnState: func(_ net.Conn, state http.ConnState) {
			if state == http.StateNew {
				connections.Add(1)
			}
		},
		Handler: WithScreenSignaling(http.NotFoundHandler(), screenshare.New(), Device{}, dir, nil, nil),
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	request, closeIdle := OpenScreenMedia(dir)
	t.Cleanup(closeIdle)
	for range 5 {
		var reply json.RawMessage
		if err := request(t.Context(), "view", strings.NewReader(`{"id":"unknown"}`), &reply); err != nil {
			t.Fatal(err)
		}
		if string(bytes.TrimSpace(reply)) != `{"state":"stopped"}` {
			t.Fatalf("unexpected reply: %s", reply)
		}
	}
	if got := connections.Load(); got != 1 {
		t.Fatalf("five frame requests opened %d daemon sockets", got)
	}
	closeIdle()
	var reply json.RawMessage
	if err := request(t.Context(), "view", strings.NewReader(`{"id":"unknown"}`), &reply); err != nil {
		t.Fatal(err)
	}
	if got := connections.Load(); got != 2 {
		t.Fatalf("expected a new socket after closing idle connections, got %d", got)
	}
}

func TestP2PScreenOfferReportsExpiredRouteAndTrust(t *testing.T) {
	dir := t.TempDir()
	device := Device{ID: "screen-test-owner"}
	if _, err := storage.LoadProfile(dir, device.ID, "Screen test"); err != nil {
		t.Fatal(err)
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("a", 64)
	handler := WithScreenSignaling(http.NotFoundHandler(), screenshare.New(), device, dir, key, func(string) bool { return false })
	payload, err := json.Marshal(screenCommand{
		Adapter: "p2p", Endpoint: "127.0.0.1:12345", Fingerprint: pin,
		Signal: screenshare.Request{Action: "offer", ID: strings.Repeat("1", 32), Offer: screenshare.JPEGFormat, CreatedAt: time.Now()},
	})
	if err != nil {
		t.Fatal(err)
	}
	check := func(want string) {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, screenRoute+"/send", bytes.NewReader(payload)))
		var reply screenshare.Reply
		if err := json.Unmarshal(response.Body.Bytes(), &reply); err != nil || response.Code != http.StatusOK || reply.State != want {
			t.Fatalf("got %d %q, want %q", response.Code, response.Body.String(), want)
		}
	}
	check("peer-not-trusted")
	if err := storage.SetPeerTrust(dir, device.ID, pin, true); err != nil {
		t.Fatal(err)
	}
	check("p2p-route-expired")
}

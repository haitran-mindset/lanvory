//go:build (darwin || linux) && cgo

package local

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lanvory.local/core/internal/screenshare"
	"lanvory.local/core/internal/storage"
)

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

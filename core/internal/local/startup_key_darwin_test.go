//go:build darwin && cgo

package local

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/storage"
)

type deadlineRecorder struct {
	*httptest.ResponseRecorder
}

func (deadlineRecorder) SetWriteDeadline(time.Time) error { return nil }

func TestTrustedOperationsUseDaemonIdentity(t *testing.T) {
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	device := Describe(public)
	dir := t.TempDir()
	if _, err := storage.LoadProfile(dir, device.ID, device.Name); err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("a", 64)
	if err := storage.SetPeerTrust(dir, device.ID, pin, true); err != nil {
		t.Fatal(err)
	}
	receiver := drop.NewReceiver(dir, func(string) (bool, error) { return false, nil }, nil)
	handler := HandlerWithResources(device, dir, receiver, nil, key, nil, nil)
	query := "?interface=lo0&endpoint=192.168.1.42%3A43110&fingerprint=" + pin
	for _, route := range []string{verifyTrustedRoute + query, verifyQUICRoute + query, sendFileRoute + query + "&path=%2Ftmp%2Funused"} {
		t.Run(route, func(t *testing.T) {
			response := deadlineRecorder{httptest.NewRecorder()}
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, route, nil))
			if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "outside the approved interface scope") {
				t.Fatalf("expected scope denial with the in-memory daemon identity; got %d: %s", response.Code, response.Body)
			}
		})
	}
}

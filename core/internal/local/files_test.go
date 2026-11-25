//go:build darwin || linux

package local

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lanvory.local/core/internal/drop"
)

func TestLocalOfferDecision(t *testing.T) {
	receiver := drop.NewReceiver(t.TempDir(), func(string) (bool, error) { return true, nil }, nil)
	mux := http.NewServeMux()
	registerFiles(mux, Device{}, t.TempDir(), receiver, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	digest := sha256.Sum256([]byte("file"))
	result := make(chan error, 1)
	go func() {
		result <- receiver.Receive(ctx, strings.Repeat("a", 64), drop.Manifest{Name: "sample.txt", Size: 4, SHA256: hex.EncodeToString(digest[:])}, func() (io.Reader, error) {
			return nil, errors.New("declined offer attempted to start")
		})
	}()
	var offers []drop.Offer
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for len(offers) == 0 {
		select {
		case <-ctx.Done():
			t.Fatal("incoming offer not visible")
		case <-tick.C:
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, offersRoute, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("list offers status=%d", response.Code)
			}
			if err := json.Unmarshal(response.Body.Bytes(), &offers); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, want := range []int{http.StatusNoContent, http.StatusNotFound} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, offersRoute+"/"+offers[0].ID+"/decline", nil))
		if response.Code != want {
			t.Fatalf("decision status=%d want=%d", response.Code, want)
		}
	}
	if err := <-result; !errors.Is(err, drop.ErrDeclined) {
		t.Fatalf("receive error=%v", err)
	}
}

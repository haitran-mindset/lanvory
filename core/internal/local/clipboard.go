//go:build darwin || linux

package local

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"time"

	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/storage"
)

const clipboardRoute = "/v1/clipboard"

type clipboardPolicyRequest struct {
	Enabled bool `json:"enabled"`
	Paused  bool `json:"paused"`
}

type clipboardSendRequest struct {
	Interface   string `json:"interface"`
	Endpoint    string `json:"endpoint"`
	Fingerprint string `json:"fingerprint"`
	Text        string `json:"text"`
}

func WithClipboard(next http.Handler, buf *clipboard.Buffer, device Device, dir string, key ed25519.PrivateKey) http.Handler {
	return WithClipboardWithNearby(next, buf, device, dir, key, nil)
}

func WithClipboardWithNearby(next http.Handler, buf *clipboard.Buffer, device Device, dir string, key ed25519.PrivateKey, hasP2PEndpoint func(string) bool) http.Handler {
	mux := http.NewServeMux()
	registerClipboard(mux, device, dir, buf, key, hasP2PEndpoint)
	mux.Handle("/", next)
	return mux
}

func registerClipboard(mux *http.ServeMux, device Device, dir string, buf *clipboard.Buffer, key ed25519.PrivateKey, hasP2PEndpoint func(string) bool) {
	if buf == nil {
		return
	}
	mux.HandleFunc("GET "+clipboardRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, buf.State())
	})
	mux.HandleFunc("POST "+clipboardRoute+"/policy", func(w http.ResponseWriter, r *http.Request) {
		var req clipboardPolicyRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid clipboard policy request", http.StatusBadRequest)
			return
		}
		buf.SetPolicy(req.Enabled, req.Paused)
		writeJSON(w, buf.State())
	})
	mux.HandleFunc("POST "+clipboardRoute+"/clear", func(w http.ResponseWriter, _ *http.Request) {
		buf.Clear()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST "+clipboardRoute+"/send", func(w http.ResponseWriter, r *http.Request) {
		var req clipboardSendRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, clipboard.MaxBytes+4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid clipboard send request", http.StatusBadRequest)
			return
		}
		endpoint, fingerprint, err := verificationInput(req.Interface, req.Endpoint, req.Fingerprint)
		if err != nil {
			http.Error(w, "Invalid peer target", http.StatusBadRequest)
			return
		}
		if err := clipboard.ValidateText(req.Text); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		trusted, err := storage.IsTrustedPeer(dir, device.ID, req.Fingerprint)
		if err != nil || !trusted {
			http.Error(w, ErrPeerNotTrusted.Error(), http.StatusForbidden)
			return
		}
		allowed, err := storage.HasGrant(dir, device.ID, storage.Grant{
			Fingerprint: req.Fingerprint,
			Capability:  permissions.ClipboardShare,
			Resource:    "clipboard",
		}, time.Now())
		if err != nil {
			http.Error(w, "Unable to read clipboard permissions", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			http.Error(w, "Clipboard sharing is not granted for this peer", http.StatusForbidden)
			return
		}
		if len(key) != ed25519.PrivateKeySize {
			http.Error(w, "Local identity unavailable", http.StatusServiceUnavailable)
			return
		}
		var sendErr error
		if req.Interface == "p2p" {
			sendErr = peer.SendClipboardLoopback(r.Context(), endpoint, fingerprint, key, req.Text, hasP2PEndpoint)
		} else {
			sendErr = peer.SendClipboard(r.Context(), req.Interface, endpoint, fingerprint, key, req.Text, func() ([]networking.Interface, error) {
				return approvedInventory(dir)
			})
		}
		if sendErr != nil {
			http.Error(w, "Clipboard send failed: "+sendErr.Error(), http.StatusBadGateway)
			return
		}
		buf.MarkLocalSent(req.Text)
		w.WriteHeader(http.StatusNoContent)
	})
}

func ClipboardState(ctx context.Context, dir string) (clipboard.State, error) {
	var state clipboard.State
	err := requestLocal(ctx, dir, http.MethodGet, clipboardRoute, &state)
	return state, err
}

func SetClipboardPolicy(ctx context.Context, dir string, enabled, paused bool) (clipboard.State, error) {
	body, err := json.Marshal(clipboardPolicyRequest{Enabled: enabled, Paused: paused})
	if err != nil {
		return clipboard.State{}, err
	}
	var state clipboard.State
	err = requestLocalBody(ctx, dir, http.MethodPost, clipboardRoute+"/policy", bytes.NewReader(body), &state)
	return state, err
}

func ClearClipboard(ctx context.Context, dir string) error {
	return requestLocal(ctx, dir, http.MethodPost, clipboardRoute+"/clear", nil)
}

func SendClipboard(ctx context.Context, dir, adapter, target, pin, text string) error {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return err
	}
	if err := clipboard.ValidateText(text); err != nil {
		return err
	}
	body, err := json.Marshal(clipboardSendRequest{
		Interface:   adapter,
		Endpoint:    endpoint.String(),
		Fingerprint: fingerprint.String(),
		Text:        text,
	})
	if err != nil {
		return err
	}
	return requestLocalBody(ctx, dir, http.MethodPost, clipboardRoute+"/send", bytes.NewReader(body), nil)
}

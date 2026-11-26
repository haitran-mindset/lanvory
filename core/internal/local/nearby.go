//go:build darwin || linux

package local

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"lanvory.local/core/internal/nearby"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
)

const nearbyRoute = "/v1/nearby"

type nearbyAdvertiseRequest struct {
	Enabled bool `json:"enabled"`
}

type nearbyScanRequest struct {
	DurationMs int `json:"durationMs,omitempty"`
}

type nearbyConnectRequest struct {
	ServiceName string `json:"serviceName"`
}

type nearbyPairRequest struct {
	Endpoint    string `json:"endpoint"`
	Fingerprint string `json:"fingerprint"`
}

// WithNearby mounts Nearby Discovery (BLE + Wi-Fi P2P) endpoints.
func WithNearby(
	next http.Handler,
	mgr *nearby.Manager,
	ensurePort func() int,
	device Device,
	dir string,
	key ed25519.PrivateKey,
	pairs *pairing.Manager,
) http.Handler {
	if mgr == nil {
		return next
	}
	mux := http.NewServeMux()
	registerNearby(mux, mgr, ensurePort, device, dir, key, pairs)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == nearbyRoute || strings.HasPrefix(r.URL.Path, nearbyRoute+"/") {
			mux.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func registerNearby(
	mux *http.ServeMux,
	mgr *nearby.Manager,
	ensurePort func() int,
	device Device,
	dir string,
	key ed25519.PrivateKey,
	pairs *pairing.Manager,
) {
	mux.HandleFunc("GET "+nearbyRoute+"/status", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, mgr.Status())
	})

	mux.HandleFunc("POST "+nearbyRoute+"/advertise", func(w http.ResponseWriter, r *http.Request) {
		var req nearbyAdvertiseRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
			http.Error(w, "Invalid advertise request", http.StatusBadRequest)
			return
		}
		targetPort := 0
		if req.Enabled && ensurePort != nil {
			targetPort = ensurePort()
		}
		status, err := mgr.SetAdvertising(req.Enabled, targetPort)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, status)
	})

	mux.HandleFunc("POST "+nearbyRoute+"/scan", func(w http.ResponseWriter, r *http.Request) {
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(15 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			http.Error(w, "Unable to configure response deadline", http.StatusInternalServerError)
			return
		}
		var req nearbyScanRequest
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req)
		duration := 2200 * time.Millisecond
		if req.DurationMs >= 1000 && req.DurationMs <= 2500 {
			duration = time.Duration(req.DurationMs) * time.Millisecond
		}
		res, err := mgr.Scan(r.Context(), duration)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, res)
	})

	mux.HandleFunc("POST "+nearbyRoute+"/connect", func(w http.ResponseWriter, r *http.Request) {
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(15 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			http.Error(w, "Unable to configure response deadline", http.StatusInternalServerError)
			return
		}
		var req nearbyConnectRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req); err != nil || strings.TrimSpace(req.ServiceName) == "" {
			http.Error(w, "serviceName is required", http.StatusBadRequest)
			return
		}
		ep, err := mgr.ConnectP2P(r.Context(), req.ServiceName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		addrPort, err := netip.ParseAddrPort(ep.Endpoint)
		if err == nil {
			if pin, probeErr := peer.ProbeP2PIdentity(r.Context(), addrPort); probeErr == nil {
				ep.Fingerprint = pin.String()
				if trusted, trustErr := storage.IsTrustedPeer(dir, device.ID, ep.Fingerprint); trustErr == nil {
					ep.Trusted = trusted
				}
			}
		}
		writeJSON(w, ep)
	})

	mux.HandleFunc("POST "+nearbyRoute+"/pair", func(w http.ResponseWriter, r *http.Request) {
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(pairingRequestTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			http.Error(w, "Unable to configure response deadline", http.StatusInternalServerError)
			return
		}
		var req nearbyPairRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req); err != nil {
			http.Error(w, "Invalid P2P pair request", http.StatusBadRequest)
			return
		}
		if !mgr.HasEndpoint(req.Endpoint) {
			http.Error(w, "Unknown P2P bridge endpoint", http.StatusForbidden)
			return
		}
		addrPort, err := netip.ParseAddrPort(req.Endpoint)
		if err != nil {
			http.Error(w, "Invalid P2P endpoint", http.StatusBadRequest)
			return
		}
		expected, err := peer.ParseFingerprint(req.Fingerprint)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := peer.PairLoopback(r.Context(), addrPort, expected, key, pairs); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func NearbyStatus(ctx context.Context, dir string) (nearby.ScanResult, error) {
	var res nearby.ScanResult
	err := requestLocal(ctx, dir, http.MethodGet, nearbyRoute+"/status", &res)
	return res, err
}

func SetNearbyAdvertising(ctx context.Context, dir string, enabled bool) (nearby.Status, error) {
	body, err := json.Marshal(nearbyAdvertiseRequest{Enabled: enabled})
	if err != nil {
		return nearby.Status{}, err
	}
	var status nearby.Status
	err = requestLocalBody(ctx, dir, http.MethodPost, nearbyRoute+"/advertise", bytes.NewReader(body), &status)
	return status, err
}

func ScanNearby(ctx context.Context, dir string, durationMs int) (nearby.ScanResult, error) {
	body, err := json.Marshal(nearbyScanRequest{DurationMs: durationMs})
	if err != nil {
		return nearby.ScanResult{}, err
	}
	var res nearby.ScanResult
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, nearbyRoute+"/scan", bytes.NewReader(body), &res, 15*time.Second)
	return res, err
}

func ConnectNearbyP2P(ctx context.Context, dir, serviceName string) (nearby.P2PEndpoint, error) {
	body, err := json.Marshal(nearbyConnectRequest{ServiceName: serviceName})
	if err != nil {
		return nearby.P2PEndpoint{}, err
	}
	var ep nearby.P2PEndpoint
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, nearbyRoute+"/connect", bytes.NewReader(body), &ep, 12*time.Second)
	return ep, err
}

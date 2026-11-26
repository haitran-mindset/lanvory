//go:build darwin || linux

package local

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
	syncengine "lanvory.local/core/internal/sync"
)

const syncRoute = "/v1/sync/folders"
const syncTimeout = 2 * time.Minute

type syncAddRequest struct {
	ID   string          `json:"id"`
	Path string          `json:"path"`
	Mode syncengine.Mode `json:"mode"`
}

type syncPauseRequest struct {
	Paused bool `json:"paused"`
}

type syncRunRequest struct {
	Interface   string `json:"interface"`
	Endpoint    string `json:"endpoint"`
	Fingerprint string `json:"fingerprint"`
	PeerLabel   string `json:"peerLabel"`
}

// WithSync mounts folder sync endpoints backed by mgr and peer synchronization using key.
func WithSync(next http.Handler, mgr *syncengine.Manager, device Device, dir string, key ed25519.PrivateKey) http.Handler {
	return WithSyncWithNearby(next, mgr, device, dir, key, nil)
}

// WithSyncWithNearby mounts folder sync endpoints with optional Wi-Fi P2P bridge support.
func WithSyncWithNearby(next http.Handler, mgr *syncengine.Manager, device Device, dir string, key ed25519.PrivateKey, hasP2PEndpoint func(string) bool) http.Handler {
	if mgr == nil {
		return next
	}
	mux := http.NewServeMux()
	registerSync(mux, device, dir, mgr, key, hasP2PEndpoint)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == syncRoute || strings.HasPrefix(r.URL.Path, syncRoute+"/") {
			mux.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func registerSync(mux *http.ServeMux, device Device, dir string, mgr *syncengine.Manager, key ed25519.PrivateKey, hasP2PEndpoint func(string) bool) {
	if mgr == nil {
		return
	}
	if stored, err := storage.SyncFolders(dir, device.ID); err == nil {
		mgr.Restore(stored)
	}
	mux.HandleFunc("GET "+syncRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, mgr.List())
	})
	mux.HandleFunc("POST "+syncRoute, func(w http.ResponseWriter, r *http.Request) {
		var req syncAddRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid sync folder request", http.StatusBadRequest)
			return
		}
		folder, err := mgr.Add(req.ID, req.Path, req.Mode)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, syncengine.ErrFolderExists) {
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		if err := storage.SaveSyncFolder(dir, device.ID, folder); err != nil {
			_ = mgr.Remove(folder.ID)
			http.Error(w, "Unable to persist sync folder", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, folder)
	})
	mux.HandleFunc("DELETE "+syncRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := mgr.Remove(id); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		_ = storage.DeleteSyncFolder(dir, device.ID, id)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST "+syncRoute+"/{id}/scan", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		folder, err := mgr.Scan(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, folder)
	})
	mux.HandleFunc("POST "+syncRoute+"/{id}/pause", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req syncPauseRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&req); err != nil {
			http.Error(w, "Invalid pause request", http.StatusBadRequest)
			return
		}
		folder, err := mgr.SetPaused(id, req.Paused)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		_ = storage.SetSyncFolderPausedStorage(dir, device.ID, id, req.Paused)
		writeJSON(w, folder)
	})
	mux.HandleFunc("POST "+syncRoute+"/{id}/run", func(w http.ResponseWriter, r *http.Request) {
		if key == nil {
			http.Error(w, "Sync key unavailable", http.StatusServiceUnavailable)
			return
		}
		id := r.PathValue("id")
		var req syncRunRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid sync run request", http.StatusBadRequest)
			return
		}
		endpoint, fingerprint, err := verificationInput(req.Interface, req.Endpoint, req.Fingerprint)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		trusted, err := storage.IsTrustedPeer(dir, device.ID, fingerprint.String())
		if err != nil || !trusted {
			http.Error(w, peer.ErrPeerIdentity.Error(), http.StatusForbidden)
			return
		}
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(syncTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			http.Error(w, "Unable to set sync deadline", http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), syncTimeout)
		defer cancel()
		label := strings.TrimSpace(req.PeerLabel)
		if label == "" {
			label = "peer"
		}
		var result syncengine.SyncResult
		if req.Interface == "p2p" {
			result, err = peer.SyncFolderLoopback(ctx, endpoint, fingerprint, key, mgr, id, label, hasP2PEndpoint)
		} else {
			result, err = peer.SyncFolder(ctx, req.Interface, endpoint, fingerprint, key, mgr, id, label, func() ([]networking.Interface, error) {
				return approvedInventory(dir)
			})
		}
		if err != nil {
			status := http.StatusBadGateway
			msg := err.Error()
			if strings.Contains(msg, "no application protocol") {
				msg = "Peer does not support folder sync yet. Update and restart Lanvory on the other device."
			} else if errors.Is(err, syncengine.ErrSyncRejected) {
				status = http.StatusForbidden
			} else if errors.Is(err, syncengine.ErrFolderNotFound) {
				status = http.StatusNotFound
			} else if errors.Is(err, peer.ErrPeerScope) {
				status = http.StatusConflict
			} else if errors.Is(err, peer.ErrPeerIdentity) {
				status = http.StatusUnprocessableEntity
			}
			http.Error(w, msg, status)
			return
		}
		writeJSON(w, result)
	})
}

func ListSyncFolders(ctx context.Context, dir string) ([]syncengine.Folder, error) {
	var folders []syncengine.Folder
	err := requestLocal(ctx, dir, http.MethodGet, syncRoute, &folders)
	return folders, err
}

func AddSyncFolder(ctx context.Context, dir, id, path string, mode syncengine.Mode) (syncengine.Folder, error) {
	body, err := json.Marshal(syncAddRequest{ID: id, Path: path, Mode: mode})
	if err != nil {
		return syncengine.Folder{}, err
	}
	var folder syncengine.Folder
	err = requestLocalBody(ctx, dir, http.MethodPost, syncRoute, bytes.NewReader(body), &folder)
	return folder, err
}

func RemoveSyncFolder(ctx context.Context, dir, id string) error {
	return requestLocal(ctx, dir, http.MethodDelete, syncRoute+"/"+id, nil)
}

func ScanSyncFolder(ctx context.Context, dir, id string) (syncengine.Folder, error) {
	var folder syncengine.Folder
	err := requestLocal(ctx, dir, http.MethodPost, syncRoute+"/"+id+"/scan", &folder)
	return folder, err
}

func SetSyncFolderPaused(ctx context.Context, dir, id string, paused bool) (syncengine.Folder, error) {
	body, err := json.Marshal(syncPauseRequest{Paused: paused})
	if err != nil {
		return syncengine.Folder{}, err
	}
	var folder syncengine.Folder
	err = requestLocalBody(ctx, dir, http.MethodPost, syncRoute+"/"+id+"/pause", bytes.NewReader(body), &folder)
	return folder, err
}

func SyncFolderWithPeer(ctx context.Context, dir, id, adapter, target, pin, peerLabel string) (syncengine.SyncResult, error) {
	if !syncengine.ValidID(id) {
		return syncengine.SyncResult{}, syncengine.ErrInvalidFolderID
	}
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	body, err := json.Marshal(syncRunRequest{
		Interface:   adapter,
		Endpoint:    endpoint.String(),
		Fingerprint: fingerprint.String(),
		PeerLabel:   peerLabel,
	})
	if err != nil {
		return syncengine.SyncResult{}, err
	}
	var result syncengine.SyncResult
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, syncRoute+"/"+id+"/run", bytes.NewReader(body), &result, syncTimeout+2*time.Second)
	return result, err
}

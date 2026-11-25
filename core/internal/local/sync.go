//go:build darwin || linux

package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"lanvory.local/core/internal/storage"
	syncengine "lanvory.local/core/internal/sync"
)

const syncRoute = "/v1/sync/folders"

type syncAddRequest struct {
	ID   string          `json:"id"`
	Path string          `json:"path"`
	Mode syncengine.Mode `json:"mode"`
}

type syncPauseRequest struct {
	Paused bool `json:"paused"`
}

func registerSync(mux *http.ServeMux, device Device, dir string, mgr *syncengine.Manager) {
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

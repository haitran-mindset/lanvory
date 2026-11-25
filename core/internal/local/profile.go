package local

import (
	"context"
	"net/http"
	"net/url"
	"sync"

	"lanvory.local/core/internal/storage"
)

const deviceNameRoute = "/v1/settings/device-name"

func registerProfile(mux *http.ServeMux, dir string, device Device) {
	var mu sync.Mutex
	mux.HandleFunc("GET "+IdentityRoute, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		snapshot := device
		mu.Unlock()
		writeJSON(w, snapshot)
	})
	mux.HandleFunc("POST "+deviceNameRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) != 1 || len(query["name"]) != 1 {
			http.Error(w, "Expected one device name", http.StatusBadRequest)
			return
		}
		name, err := storage.NormalizeProfileName(query.Get("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mu.Lock()
		err = storage.RenameProfile(dir, device.ID, name)
		if err == nil {
			device.Name = name
		}
		snapshot := device
		mu.Unlock()
		if err != nil {
			http.Error(w, "Unable to save device name", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, snapshot)
	})
}

func SetDeviceName(ctx context.Context, dir, name string) (Device, error) {
	name, err := storage.NormalizeProfileName(name)
	if err != nil {
		return Device{}, err
	}
	var device Device
	query := url.Values{"name": {name}}
	err = requestLocal(ctx, dir, http.MethodPost, deviceNameRoute+"?"+query.Encode(), &device)
	return device, err
}

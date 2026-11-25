//go:build darwin || linux

package local

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"sync"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/storage"
)

const servicesRoute = "/v1/services"

func registerServices(mux *http.ServeMux, dir, owner string, policyMu *sync.Mutex) {
	mux.HandleFunc("GET "+servicesRoute, func(w http.ResponseWriter, _ *http.Request) {
		services, err := storage.SharedServices(dir, owner)
		if err != nil {
			http.Error(w, "Unable to list shared services", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, services)
	})
	mux.HandleFunc("PUT "+servicesRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		query, err := url.ParseQuery(r.URL.RawQuery)
		target, parseErr := netip.ParseAddrPort(query.Get("target"))
		if err != nil || parseErr != nil || len(query) != 1 || len(query["target"]) != 1 || !bridge.ValidID(id) || !bridge.ValidTarget(target) {
			http.Error(w, "Expected a service ID and literal loopback target", http.StatusBadRequest)
			return
		}
		policyMu.Lock()
		defer policyMu.Unlock()
		if r.Context().Err() != nil {
			return
		}
		switch err := storage.RegisterService(dir, owner, bridge.Service{ID: id, Target: target}); {
		case errors.Is(err, bridge.ErrServiceExists):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, bridge.ErrServiceLimit):
			http.Error(w, err.Error(), http.StatusInsufficientStorage)
		case err != nil:
			http.Error(w, "Unable to register shared service", http.StatusServiceUnavailable)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
	mux.HandleFunc("DELETE "+servicesRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !bridge.ValidID(id) || r.URL.RawQuery != "" {
			http.Error(w, "Invalid service ID", http.StatusBadRequest)
			return
		}
		policyMu.Lock()
		defer policyMu.Unlock()
		if r.Context().Err() != nil {
			return
		}
		if err := storage.RemoveService(dir, owner, id); err != nil {
			http.Error(w, "Unable to remove shared service", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func ListServices(ctx context.Context, dir string) ([]bridge.Service, error) {
	var services []bridge.Service
	err := requestLocal(ctx, dir, http.MethodGet, servicesRoute, &services)
	return services, err
}

func UpdateService(ctx context.Context, dir, id, address string, allow bool) error {
	if !bridge.ValidID(id) {
		return errors.New("invalid service ID")
	}
	route := servicesRoute + "/" + id
	if !allow {
		return requestLocal(ctx, dir, http.MethodDelete, route, nil)
	}
	target, err := netip.ParseAddrPort(address)
	if err != nil || !bridge.ValidTarget(target) {
		return errors.New("expected a literal loopback address and port")
	}
	return requestLocal(ctx, dir, http.MethodPut, route+"?"+url.Values{"target": {target.String()}}.Encode(), nil)
}

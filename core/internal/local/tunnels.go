//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
)

const tunnelsRoute = "/v1/tunnels"

type tunnelInput struct {
	adapter  string
	endpoint netip.AddrPort
	pin      peer.Fingerprint
	service  string
	bind     netip.AddrPort
}

func parseTunnel(adapter, target, pin, service, bind string) (tunnelInput, error) {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return tunnelInput{}, err
	}
	local, err := netip.ParseAddrPort(bind)
	if err != nil || !bridge.ValidBind(local) || !bridge.ValidID(service) {
		return tunnelInput{}, errors.New("expected a service ID and literal loopback bind address")
	}
	return tunnelInput{adapter, endpoint, fingerprint, service, local}, nil
}

func registerTunnels(mux *http.ServeMux, device Device, dir string, tunnels *bridge.Tunnels, key ed25519.PrivateKey) {
	if tunnels == nil {
		return
	}
	mux.HandleFunc("GET "+tunnelsRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, tunnels.List())
	})
	mux.HandleFunc("POST "+tunnelsRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		params := []string{"interface", "endpoint", "fingerprint", "service", "bind"}
		if err != nil || len(query) != len(params) {
			http.Error(w, "Invalid tunnel parameters", http.StatusBadRequest)
			return
		}
		for _, param := range params {
			if len(query[param]) != 1 {
				http.Error(w, "Invalid tunnel parameters", http.StatusBadRequest)
				return
			}
		}
		input, err := parseTunnel(query.Get("interface"), query.Get("endpoint"), query.Get("fingerprint"), query.Get("service"), query.Get("bind"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		inventory := func() ([]networking.Interface, error) { return approvedInventory(dir) }
		current, err := inventory()
		if err != nil {
			http.Error(w, "Unable to read network policy", http.StatusServiceUnavailable)
			return
		}
		initial := networking.CheckScope(current, input.adapter, input.endpoint.Addr())
		source, err := netip.ParseAddr(initial.Source)
		if !initial.Allowed || err != nil {
			http.Error(w, peer.ErrPeerScope.Error(), http.StatusConflict)
			return
		}
		index := networking.ListenerIndex(current, input.adapter, source)
		if index == 0 {
			http.Error(w, peer.ErrPeerScope.Error(), http.StatusConflict)
			return
		}
		allowed := func() bool {
			trusted, err := storage.IsTrustedPeer(dir, device.ID, input.pin.String())
			if err != nil || !trusted {
				return false
			}
			current, err := inventory()
			if err != nil {
				return false
			}
			scope := networking.CheckScope(current, input.adapter, input.endpoint.Addr())
			return scope.Allowed && scope.Source == initial.Source && networking.ListenerIndex(current, input.adapter, source) == index
		}
		connect := func(ctx context.Context) (net.Conn, error) {
			return peer.OpenService(ctx, input.adapter, input.endpoint, input.pin, key, input.service, inventory)
		}
		tunnel, err := tunnels.Open(r.Context(), input.bind, input.service, connect, allowed)
		switch {
		case errors.Is(err, bridge.ErrNotAvailable):
			http.Error(w, "Tunnel is not permitted by current local policy", http.StatusForbidden)
		case errors.Is(err, bridge.ErrTunnelLimit):
			http.Error(w, err.Error(), http.StatusTooManyRequests)
		case err != nil:
			http.Error(w, "Unable to bind local tunnel", http.StatusServiceUnavailable)
		default:
			writeJSON(w, tunnel)
		}
	})
	mux.HandleFunc("DELETE "+tunnelsRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validOfferID(id) || r.URL.RawQuery != "" {
			http.Error(w, "Invalid tunnel ID", http.StatusBadRequest)
			return
		}
		if err := tunnels.Stop(r.Context(), id); err != nil {
			if errors.Is(err, bridge.ErrTunnelNotFound) {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			http.Error(w, "Tunnel closure is still in progress", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func OpenTunnel(ctx context.Context, dir, adapter, target, pin, service, bind string) (bridge.Tunnel, error) {
	input, err := parseTunnel(adapter, target, pin, service, bind)
	if err != nil {
		return bridge.Tunnel{}, err
	}
	query := url.Values{
		"interface": {input.adapter}, "endpoint": {input.endpoint.String()}, "fingerprint": {input.pin.String()},
		"service": {input.service}, "bind": {input.bind.String()},
	}
	var response bridge.Tunnel
	err = requestLocal(ctx, dir, http.MethodPost, tunnelsRoute+"?"+query.Encode(), &response)
	return response, err
}

func ListTunnels(ctx context.Context, dir string) ([]bridge.Tunnel, error) {
	var result []bridge.Tunnel
	err := requestLocal(ctx, dir, http.MethodGet, tunnelsRoute, &result)
	return result, err
}

func StopTunnel(ctx context.Context, dir, id string) error {
	if !validOfferID(id) {
		return errors.New("invalid tunnel ID")
	}
	return requestLocal(ctx, dir, http.MethodDelete, tunnelsRoute+"/"+id, nil)
}

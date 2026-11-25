package local

import (
	"context"
	"net/http"
	"net/netip"
	"net/url"

	"lanvory.local/core/internal/discovery"
)

const listenerStatusRoute = "/v1/network/listener"

type ListenerStatus struct {
	ServiceName string `json:"-"`
	State       string `json:"state"`
	Adapter     string `json:"adapter,omitempty"`
	Endpoint    string `json:"endpoint,omitempty"`
	Pairing     bool   `json:"pairing"`
}

func WithListenerStatus(handler http.Handler, status func() ListenerStatus, start func(string, netip.AddrPort, bool, bool, bool) error, stop func()) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+listenerStatusRoute, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, status())
	})
	mux.HandleFunc("POST "+listenerStatusRoute+"/start", func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		adapter := query.Get("interface")
		bind, bindErr := netip.ParseAddrPort(query.Get("bind"))
		pairing := true
		if values, supplied := query["pairing"]; supplied {
			if len(values) != 1 || (values[0] != "true" && values[0] != "false") {
				http.Error(w, "Pairing must be true or false", http.StatusBadRequest)
				return
			}
			pairing = values[0] == "true"
			query.Del("pairing")
		}
		if err != nil || bindErr != nil || !bind.Addr().Is4() || !interfaceName.MatchString(adapter) ||
			len(query) != 2 || len(query["interface"]) != 1 || len(query["bind"]) != 1 {
			http.Error(w, "Expected an adapter and IPv4 bind address", http.StatusBadRequest)
			return
		}
		if err := start(adapter, bind, discovery.CanPublish, true, pairing); err != nil {
			http.Error(w, "Unable to start the LAN listener on this adapter and address", http.StatusConflict)
			return
		}
		writeJSON(w, status())
	})
	mux.HandleFunc("POST "+listenerStatusRoute+"/stop", func(w http.ResponseWriter, r *http.Request) {
		stop()
		writeJSON(w, status())
	})
	mux.Handle("/", handler)
	return mux
}

func GetListenerStatus(ctx context.Context, dir string) (ListenerStatus, error) {
	var result ListenerStatus
	err := requestLocal(ctx, dir, http.MethodGet, listenerStatusRoute, &result)
	return result, err
}

func StartListener(ctx context.Context, dir, adapter, bind string, pairing bool) (ListenerStatus, error) {
	query := url.Values{"interface": {adapter}, "bind": {bind}}
	if !pairing {
		query.Set("pairing", "false")
	}
	return updateListener(ctx, dir, "/start?"+query.Encode())
}

func StopListener(ctx context.Context, dir string) (ListenerStatus, error) {
	return updateListener(ctx, dir, "/stop")
}

func updateListener(ctx context.Context, dir, action string) (ListenerStatus, error) {
	var result ListenerStatus
	err := requestLocal(ctx, dir, http.MethodPost, listenerStatusRoute+action, &result)
	return result, err
}

//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"net/url"
	"time"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/peer"
)

const pairingRoute = "/v1/pairing"
const pairingStartRoute = pairingRoute + "/start"
const pairingRequestTimeout = pairing.Window + 7*time.Second

func registerPairing(mux *http.ServeMux, device Device, dir string, key ed25519.PrivateKey, manager *pairing.Manager) {
	if manager == nil {
		return
	}
	mux.HandleFunc("GET "+pairingRoute, func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, manager.List()) })
	mux.HandleFunc("POST "+pairingStartRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		adapter, target, pin := query.Get("interface"), query.Get("endpoint"), query.Get("fingerprint")
		endpoint, fingerprint, inputErr := verificationInput(adapter, target, pin)
		if err != nil || inputErr != nil || len(query) != 3 || len(query["interface"]) != 1 ||
			len(query["endpoint"]) != 1 || len(query["fingerprint"]) != 1 || fingerprint.String() == device.Fingerprint {
			http.Error(w, "Expected a remote fingerprint, adapter and IPv4 endpoint", http.StatusBadRequest)
			return
		}
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(pairingRequestTimeout)); err != nil {
			http.Error(w, "Unable to initialize pairing", http.StatusServiceUnavailable)
			return
		}
		err = peer.Pair(r.Context(), adapter, endpoint, fingerprint, key, manager, func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		})
		switch {
		case errors.Is(err, peer.ErrPeerScope):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, peer.ErrPeerIdentity):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		case errors.Is(err, pairing.ErrLimit):
			http.Error(w, err.Error(), http.StatusTooManyRequests)
		case errors.Is(err, context.DeadlineExceeded):
			http.Error(w, "Pairing expired", http.StatusGatewayTimeout)
		case errors.Is(err, pairing.ErrDeclined), errors.Is(err, pairing.ErrUnavailable), errors.Is(err, context.Canceled):
			http.Error(w, "Pairing was cancelled or declined", http.StatusGone)
		case err != nil:
			http.Error(w, "Pairing did not complete", http.StatusBadGateway)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
	mux.HandleFunc("POST "+pairingRoute+"/{id}/{decision}", func(w http.ResponseWriter, r *http.Request) {
		id, decision := r.PathValue("id"), r.PathValue("decision")
		query, err := url.ParseQuery(r.URL.RawQuery)
		approve := decision == "approve"
		validQuery := len(query) == 0
		if approve {
			validQuery = len(query) == 1 && len(query["code"]) == 1 && len(query.Get("code")) <= 35
		}
		if err != nil || !validOfferID(id) || (!approve && decision != "decline") || !validQuery {
			http.Error(w, "Invalid pairing decision", http.StatusBadRequest)
			return
		}
		switch err := manager.Decide(id, query.Get("code"), approve); {
		case errors.Is(err, pairing.ErrCode):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		case err != nil:
			http.Error(w, "Pairing request is no longer available", http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}

func StartPairing(ctx context.Context, dir, adapter, target, pin string) error {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return err
	}
	query := url.Values{"interface": {adapter}, "endpoint": {endpoint.String()}, "fingerprint": {fingerprint.String()}}
	return requestLocalTimed(ctx, dir, http.MethodPost, pairingStartRoute+"?"+query.Encode(), nil, pairingRequestTimeout)
}

func PairingRequests(ctx context.Context, dir string) ([]pairing.Request, error) {
	var requests []pairing.Request
	err := requestLocal(ctx, dir, http.MethodGet, pairingRoute, &requests)
	return requests, err
}

func DecidePairing(ctx context.Context, dir, id, code string, approve bool) error {
	if !validOfferID(id) {
		return pairing.ErrUnavailable
	}
	route := pairingRoute + "/" + id + "/decline"
	if approve {
		if len(code) > 35 {
			return pairing.ErrCode
		}
		route = pairingRoute + "/" + id + "/approve?" + url.Values{"code": {code}}.Encode()
	}
	return requestLocal(ctx, dir, http.MethodPost, route, nil)
}

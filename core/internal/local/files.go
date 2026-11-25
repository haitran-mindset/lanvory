//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"time"

	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
)

const offersRoute = "/v1/files/offers"
const transfersRoute = "/v1/files/transfers"
const sendFileRoute = "/v1/files/send"
const sendTimeout = 4 * time.Minute

func registerFiles(mux *http.ServeMux, device Device, dir string, receiver *drop.Receiver, key ed25519.PrivateKey) {
	if receiver == nil {
		return
	}
	mux.HandleFunc("GET "+transfersRoute, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		response := json.NewEncoder(w)
		response.SetEscapeHTML(false)
		_ = response.Encode(receiver.Tracker().Snapshot())
	})
	mux.HandleFunc("DELETE "+transfersRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validOfferID(id) {
			http.Error(w, "Invalid transfer ID", http.StatusBadRequest)
			return
		}
		if err := receiver.Tracker().DeleteHistory(id); err != nil {
			if errors.Is(err, drop.ErrActiveTransfer) {
				http.Error(w, "Transfer is still active", http.StatusConflict)
			} else {
				http.Error(w, "Unable to delete transfer history", http.StatusServiceUnavailable)
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET "+offersRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, receiver.Pending())
	})
	mux.HandleFunc("POST "+offersRoute+"/{id}/{decision}", func(w http.ResponseWriter, r *http.Request) {
		id, decision := r.PathValue("id"), r.PathValue("decision")
		if !validOfferID(id) || (decision != "approve" && decision != "decline") {
			http.Error(w, "Invalid incoming offer decision", http.StatusBadRequest)
			return
		}
		if err := receiver.Decide(id, decision == "approve"); err != nil {
			http.Error(w, "Incoming offer is no longer available", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	slots := make(chan struct{}, 2)
	mux.HandleFunc("POST "+sendFileRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		adapter, target, pin, path := query.Get("interface"), query.Get("endpoint"), query.Get("fingerprint"), query.Get("path")
		endpoint, fingerprint, inputErr := verificationInput(adapter, target, pin)
		if err != nil || inputErr != nil || len(query) != 4 ||
			len(query["interface"]) != 1 || len(query["endpoint"]) != 1 ||
			len(query["fingerprint"]) != 1 || len(query["path"]) != 1 ||
			!filepath.IsAbs(path) || len(path) > 1000 {
			http.Error(w, "Invalid file send request", http.StatusBadRequest)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "Outgoing transfer limit reached", http.StatusTooManyRequests)
			return
		}
		if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(sendTimeout)); err != nil {
			http.Error(w, "Unable to initialize file transfer", http.StatusServiceUnavailable)
			return
		}

		trusted := func() (bool, error) { return storage.IsTrustedPeer(dir, device.ID, fingerprint.String()) }
		allowed, err := trusted()
		if err != nil {
			http.Error(w, "Unable to read trusted peers", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			http.Error(w, ErrPeerNotTrusted.Error(), http.StatusForbidden)
			return
		}
		if len(key) != ed25519.PrivateKeySize {
			http.Error(w, "Local identity unavailable", http.StatusServiceUnavailable)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), sendTimeout)
		defer cancel()
		err = peer.SendFile(ctx, adapter, endpoint, fingerprint, key, path, func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		}, trusted, receiver.Tracker())
		switch {
		case errors.Is(err, peer.ErrPeerScope):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, peer.ErrPeerIdentity):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		case errors.Is(err, drop.ErrNotAccepted):
			http.Error(w, err.Error(), http.StatusBadGateway)
		case err != nil:
			http.Error(w, "File transfer did not complete: "+err.Error(), http.StatusBadGateway)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}

func validOfferID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

func IncomingOffers(ctx context.Context, dir string) ([]drop.Offer, error) {
	var offers []drop.Offer
	err := requestLocal(ctx, dir, http.MethodGet, offersRoute, &offers)
	return offers, err
}

func DecideOffer(ctx context.Context, dir, id string, approve bool) error {
	if !validOfferID(id) {
		return drop.ErrOfferUnavailable
	}
	decision := "decline"
	if approve {
		decision = "approve"
	}
	return requestLocal(ctx, dir, http.MethodPost, offersRoute+"/"+id+"/"+decision, nil)
}

func SendFile(ctx context.Context, dir, adapter, target, pin, path string) error {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return err
	}
	if len(path) > 1000 {
		return errors.New("file path is too long")
	}
	query := url.Values{"interface": {adapter}, "endpoint": {endpoint.String()}, "fingerprint": {fingerprint.String()}, "path": {path}}
	return requestLocalTimed(ctx, dir, http.MethodPost, sendFileRoute+"?"+query.Encode(), nil, sendTimeout+2*time.Second)
}

func FileTransfers(ctx context.Context, dir string) (drop.Activity, error) {
	var result drop.Activity
	err := requestLocal(ctx, dir, http.MethodGet, transfersRoute, &result)
	return result, err
}

func DeleteFileTransfer(ctx context.Context, dir, id string) error {
	if !validOfferID(id) {
		return errors.New("invalid transfer ID")
	}
	return requestLocal(ctx, dir, http.MethodDelete, transfersRoute+"/"+id, nil)
}

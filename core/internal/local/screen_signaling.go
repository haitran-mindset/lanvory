//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/screenshare"
	"lanvory.local/core/internal/storage"
)

const screenRoute = "/v1/screen-signaling"

type screenCommand struct {
	Adapter     string              `json:"adapter"`
	Endpoint    string              `json:"endpoint"`
	Fingerprint string              `json:"fingerprint"`
	Signal      screenshare.Request `json:"signal"`
	ID          string              `json:"id"`
	Accept      bool                `json:"accept"`
	After       uint64              `json:"after"`
	Answer      string              `json:"answer"`
}

func WithScreenSignaling(next http.Handler, manager *screenshare.Manager, device Device, dir string, key ed25519.PrivateKey) http.Handler {
	if manager == nil {
		return next
	}
	trusted := func(fingerprint string) bool {
		ok, err := storage.IsTrustedPeer(dir, device.ID, fingerprint)
		return err == nil && ok
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+screenRoute+"/pending", func(w http.ResponseWriter, _ *http.Request) {
		pending := manager.Pending()
		visible := pending[:0]
		for _, invite := range pending {
			if trusted(invite.Peer) {
				visible = append(visible, invite)
			}
		}
		writeJSON(w, visible)
	})
	mux.HandleFunc("POST "+screenRoute+"/{action}", func(w http.ResponseWriter, r *http.Request) {
		var command screenCommand
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, screenshare.MaxMessage))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&command) != nil || decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "Invalid screen signaling request", http.StatusBadRequest)
			return
		}
		switch r.PathValue("action") {
		case "send":
			if command.Adapter == "p2p" || !trusted(command.Fingerprint) || len(command.Signal.Offer) > screenshare.MaxDescription {
				http.Error(w, "Screen signaling requires a trusted LAN peer", http.StatusForbidden)
				return
			}
			endpoint, pin, err := verificationInput(command.Adapter, command.Endpoint, command.Fingerprint)
			if err != nil {
				http.Error(w, "Invalid peer target", http.StatusBadRequest)
				return
			}
			reply, err := peer.SendScreenSignal(r.Context(), command.Adapter, endpoint, pin, key, command.Signal, func() ([]networking.Interface, error) {
				return approvedInventory(dir)
			})
			if err != nil {
				http.Error(w, "Screen signaling unavailable on this peer", http.StatusBadGateway)
				return
			}
			writeJSON(w, reply)
		case "view":
			writeJSON(w, manager.View(command.ID, command.After, trusted))
		case "decide":
			for _, invitation := range manager.Pending() {
				if invitation.ID != command.ID || !trusted(invitation.Peer) {
					continue
				}
				if manager.Decide(command.ID, command.Accept, command.Answer) == nil {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			http.Error(w, screenshare.ErrUnavailable.Error(), http.StatusConflict)
		case "stop":
			if manager.Stop(command.ID) != nil {
				http.Error(w, screenshare.ErrUnavailable.Error(), http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})
	mux.Handle("/", next)
	return mux
}

func ScreenSignaling(ctx context.Context, dir, action string, body io.Reader, result any) error {
	switch action {
	case "pending":
		return requestLocal(ctx, dir, http.MethodGet, screenRoute+"/pending", result)
	case "send", "view":
		return requestLocalBody(ctx, dir, http.MethodPost, screenRoute+"/"+action, body, result)
	case "decide", "stop":
		return requestLocalBody(ctx, dir, http.MethodPost, screenRoute+"/"+action, body, nil)
	default:
		return screenshare.ErrUnavailable
	}
}

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/netip"
	"slices"
	"time"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/screenshare"
)

func SendScreenSignal(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, request screenshare.Request, inventory func() ([]networking.Interface, error)) (screenshare.Reply, error) {
	var reply screenshare.Reply
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	config, err := clientIdentity(expected, key, screenshare.Protocol)
	if err != nil {
		return reply, err
	}
	conn, err := dialScoped(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return reply, err
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return reply, err
	}
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return reply, err
	}
	if err := json.NewDecoder(io.LimitReader(conn, screenshare.MaxMessage)).Decode(&reply); err != nil {
		return reply, err
	}
	switch reply.State {
	case "pending", "declined", "stopped":
		if reply.Answer == "" {
			return reply, nil
		}
	case "accepted":
		if reply.Answer != "" && len(reply.Answer) <= screenshare.MaxDescription {
			return reply, nil
		}
	}
	return screenshare.Reply{}, screenshare.ErrUnavailable
}

// EnableScreenSignaling opts an already scoped TCP listener into screen invitations.
func (l *Listener) EnableScreenSignaling(manager *screenshare.Manager) {
	if l == nil || l.index == 0 || l.trusted == nil || manager == nil {
		return
	}
	l.screenSignaling = manager
	previous := l.config.GetConfigForClient
	config := trustedTLS(l.config, screenshare.Protocol, l.trusted)
	l.config.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if slices.Contains(hello.SupportedProtos, screenshare.Protocol) {
			return config, nil
		}
		if previous != nil {
			return previous(hello)
		}
		return nil, nil
	}
}

func (l *Listener) receiveScreenSignal(session *tls.Conn, remote netip.Addr) {
	pin, err := certificateFingerprint(session.ConnectionState(), screenshare.Protocol)
	if err != nil || l.screenSignaling == nil {
		return
	}
	var request screenshare.Request
	if err := json.NewDecoder(io.LimitReader(session, screenshare.MaxMessage)).Decode(&request); err != nil {
		return
	}
	trusted, err := l.trusted(pin.String())
	if err != nil || !trusted || !l.currentScope(remote) {
		return
	}
	reply, err := l.screenSignaling.Handle(pin.String(), request)
	if err != nil {
		reply = screenshare.Reply{State: "unavailable"}
	}
	_ = json.NewEncoder(session).Encode(reply)
}

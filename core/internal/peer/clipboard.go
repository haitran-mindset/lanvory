package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"errors"
	"net/netip"
	"slices"
	"time"

	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/networking"
)

var ErrClipboardRejected = errors.New("peer declined or disabled shared clipboard")

func SendClipboard(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, text string, inventory func() ([]networking.Interface, error)) error {
	if err := clipboard.ValidateText(text); err != nil {
		return err
	}
	config, err := clientIdentity(expected, key, clipboard.Protocol)
	if err != nil {
		return err
	}
	conn, err := dialResource(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
	}
	if err := clipboard.WritePacket(conn, text); err != nil {
		return err
	}
	accepted, err := clipboard.ReadAck(conn)
	if err != nil {
		return err
	}
	if !accepted {
		return ErrClipboardRejected
	}
	return nil
}

// EnableClipboard registers the lanvory-clipboard/1 mTLS handler on an existing Listener.
func (l *Listener) EnableClipboard(buf *clipboard.Buffer, allowed func(string) bool) {
	if l == nil || buf == nil || l.trusted == nil {
		return
	}
	l.clipboardBuf = buf
	l.clipboardAllowed = allowed
	baseGet := l.config.GetConfigForClient
	clipCfg := trustedTLS(l.config, clipboard.Protocol, l.trusted)
	l.config.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if slices.Contains(hello.SupportedProtos, clipboard.Protocol) {
			return clipCfg, nil
		}
		if baseGet != nil {
			return baseGet(hello)
		}
		return nil, nil
	}
}

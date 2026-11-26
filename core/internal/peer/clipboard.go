package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"errors"
	"net"
	"net/netip"
	"slices"
	"strings"
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
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "no application protocol") {
		// Fallback to TCP when the remote QUIC listener does not advertise lanvory-clipboard/1.
		conn, err = dialScoped(ctx, adapter, endpoint, inventory, config)
	}
	if err != nil {
		return err
	}
	return sendClipboardConn(ctx, conn, text)
}

// SendClipboardLoopback sends a clipboard snippet over a registered Wi-Fi P2P loopback bridge.
func SendClipboardLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, text string, hasEndpoint func(string) bool) error {
	if err := clipboard.ValidateText(text); err != nil {
		return err
	}
	config, err := clientIdentity(expected, key, clipboard.Protocol)
	if err != nil {
		return err
	}
	conn, err := dialLoopback(ctx, endpoint, config, hasEndpoint)
	if err != nil {
		return err
	}
	return sendClipboardConn(ctx, conn, text)
}

func sendClipboardConn(ctx context.Context, conn net.Conn, text string) error {
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

func serveClipboardConn(_ context.Context, conn net.Conn, fingerprint string, buf *clipboard.Buffer, allowed func(string) bool) error {
	if buf == nil || (allowed != nil && !allowed(fingerprint)) {
		_ = clipboard.WriteAck(conn, false)
		return ErrClipboardRejected
	}
	_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
	text, err := clipboard.ReadPacket(conn)
	if err != nil {
		_ = clipboard.WriteAck(conn, false)
		return err
	}
	_, recvErr := buf.Receive(fingerprint, text)
	if err := clipboard.WriteAck(conn, recvErr == nil); err != nil {
		return err
	}
	return recvErr
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

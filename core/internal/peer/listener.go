package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"sync"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
	syncengine "lanvory.local/core/internal/sync"
)

const protocol = "lanvory-identity/1"

type Listener struct {
	net.Listener
	source           netip.Addr
	name             string
	index            int
	inventory        func() ([]networking.Interface, error)
	config           *tls.Config
	trusted          func(string) (bool, error)
	receiver         *drop.Receiver
	services         bridge.Lookup
	pairs            *pairing.Manager
	clipboardBuf     *clipboard.Buffer
	clipboardAllowed func(string) bool
	syncMgr          *syncengine.Manager
	syncAllowed      func(string, string) bool
	mountReg         *mount.Registry
	mountAllowed     func(string, string) bool
}

func Listen(ctx context.Context, name string, bind netip.AddrPort, key ed25519.PrivateKey, inventory func() ([]networking.Interface, error), trusted func(string) (bool, error), receiver *drop.Receiver, services bridge.Lookup, pairs *pairing.Manager) (*Listener, error) {
	interfaces, err := inventory()
	if err != nil {
		return nil, err
	}
	index := networking.ListenerIndex(interfaces, name, bind.Addr())
	if index == 0 {
		return nil, errors.New("peer bind address must belong to an active approved adapter")
	}
	config, err := identityTLS(key)
	if err != nil {
		return nil, err
	}
	socket := net.ListenConfig{Control: bindInterface(index)}
	listener, err := socket.Listen(ctx, "tcp4", bind.String())
	if err != nil {
		return nil, err
	}
	config = mutualServer(config, trusted, receiver != nil, services != nil)
	if pairs != nil {
		config = enablePairingTLS(config)
	}
	return &Listener{
		Listener:  listener,
		source:    bind.Addr(),
		name:      name,
		index:     index,
		inventory: inventory,
		config:    config,
		trusted:   trusted,
		receiver:  receiver,
		services:  services,
		pairs:     pairs,
	}, nil
}

func identityTLS(key ed25519.PrivateKey) (*tls.Config, error) {
	if len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid Ed25519 identity key")
	}
	now := time.Now()
	cert := &x509.Certificate{
		NotBefore:   now.Add(-time.Minute),
		NotAfter:    now.AddDate(1, 0, 0),
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, key.Public(), key)
	if err != nil {
		return nil, fmt.Errorf("create peer certificate: %w", err)
	}
	return &tls.Config{
		MinVersion:             tls.VersionTLS13,
		NextProtos:             []string{protocol},
		SessionTicketsDisabled: true,
		Certificates:           []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
	}, nil
}

// Serve closes the listener after cancellation or when its scope is lost.
// Successful handshakes prove possession of the advertised key and stop there.
func (l *Listener) Serve(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				l.Close()
				return
			case <-tick.C:
				if !l.currentScope(netip.Addr{}) {
					l.Close()
					return
				}
			}
		}
	}()
	var sessions sync.WaitGroup
	defer func() {
		cancel()
		<-watchDone
		sessions.Wait()
	}()
	slots := make(chan struct{}, 16)
	for {
		conn, err := l.Accept()
		if errors.Is(err, net.ErrClosed) {
			return nil
		}
		if err != nil {
			return err
		}
		select {
		case slots <- struct{}{}:
		default:
			conn.Close()
			continue
		}
		sessions.Go(func() {
			defer func() { <-slots; conn.Close() }()
			remote := conn.RemoteAddr().(*net.TCPAddr).AddrPort().Addr().Unmap()
			if !l.currentScope(remote) {
				return
			}
			deadline, stop := context.WithTimeout(ctx, 2*time.Second)
			defer stop()
			session := tls.Server(conn, l.config)
			limit, _ := deadline.Deadline()
			if err := conn.SetDeadline(limit); err != nil {
				return
			}
			if err := session.HandshakeContext(deadline); err != nil {
				return
			}
			if !l.currentScope(remote) {
				return
			}
			switch session.ConnectionState().NegotiatedProtocol {
			case pairing.Protocol:
				_ = ExchangePairing(ctx, session, l.pairs, "incoming", func() bool { return l.currentScope(remote) })
			case trustedProtocol:
				_ = acknowledgeMutual(session, l.trusted)
			case bridge.Protocol:
				pin, err := certificateFingerprint(session.ConnectionState(), bridge.Protocol)
				if err != nil {
					return
				}
				_ = bridge.Serve(ctx, session, pin.String(), l.services, func() bool { return l.currentScope(remote) })
			case drop.Protocol:
				if err := conn.SetDeadline(time.Time{}); err != nil {
					return
				}
				pin, err := certificateFingerprint(session.ConnectionState(), drop.Protocol)
				if err != nil {
					return
				}
				l.receiveFile(ctx, session, remote, pin.String())
			case clipboard.Protocol:
				if l.clipboardBuf == nil {
					return
				}
				pin, err := certificateFingerprint(session.ConnectionState(), clipboard.Protocol)
				if err != nil {
					return
				}
				if l.clipboardAllowed != nil && !l.clipboardAllowed(pin.String()) {
					_ = clipboard.WriteAck(session, false)
					return
				}
				text, err := clipboard.ReadPacket(session)
				if err != nil {
					_ = clipboard.WriteAck(session, false)
					return
				}
				_, recvErr := l.clipboardBuf.Receive(pin.String(), text)
				_ = clipboard.WriteAck(session, recvErr == nil)
			case syncengine.Protocol:
				if l.syncMgr == nil {
					return
				}
				pin, err := certificateFingerprint(session.ConnectionState(), syncengine.Protocol)
				if err != nil {
					return
				}
				if err := conn.SetDeadline(time.Time{}); err != nil {
					return
				}
				_ = syncengine.ServeConn(ctx, session, pin.String(), l.syncMgr, l.syncAllowed)
			case mount.Protocol:
				if l.mountReg == nil {
					return
				}
				pin, err := certificateFingerprint(session.ConnectionState(), mount.Protocol)
				if err != nil {
					return
				}
				if err := conn.SetDeadline(time.Time{}); err != nil {
					return
				}
				_ = serveMountConn(ctx, session, pin.String(), l.mountReg, l.mountAllowed, func() bool { return l.currentScope(remote) })
			}
		})
	}
}

func (l *Listener) currentScope(remote netip.Addr) bool {
	if l.index == 0 && l.source.IsLoopback() {
		return !remote.IsValid() || remote.IsLoopback()
	}
	interfaces, err := l.inventory()
	if err != nil || networking.ListenerIndex(interfaces, l.name, l.source) != l.index {
		return false
	}
	if !remote.IsValid() {
		return true
	}
	decision := networking.CheckScope(interfaces, l.name, remote)
	return decision.Allowed && decision.Source == l.source.String()
}

func (l *Listener) receiveFile(ctx context.Context, conn *tls.Conn, remote netip.Addr, fingerprint string) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !l.currentScope(remote) {
					cancel()
					return
				}
			}
		}
	}()
	_ = l.receiver.ReceiveStream(ctx, conn, fingerprint, func() bool { return l.currentScope(remote) })
	cancel()
	<-stopped
}

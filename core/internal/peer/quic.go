package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/networking"
)

const quicTrustedProtocol = "lanvory-quic-trusted/1"
const quicChallenge = 1
const quicScopesRefresh = 500 * time.Millisecond

var ErrQUICUnreachable = errors.New("QUIC handshake timed out")

// scopedPackets validates source and destination addresses before handing
// datagrams to QUIC. The underlying socket remains bound to the adapter.
type scopedPackets struct {
	net.PacketConn
	permitted func(netip.AddrPort) bool
}

func (s scopedPackets) ReadFrom(data []byte) (int, net.Addr, error) {
	for {
		n, addr, err := s.PacketConn.ReadFrom(data)
		if err != nil {
			return n, addr, err
		}
		if endpoint, ok := udpEndpoint(addr); ok && s.permitted(endpoint) {
			return n, addr, nil
		}
	}
}
func (s scopedPackets) WriteTo(data []byte, addr net.Addr) (int, error) {
	endpoint, ok := udpEndpoint(addr)
	if !ok || !s.permitted(endpoint) {
		return 0, ErrPeerScope
	}
	return s.PacketConn.WriteTo(data, addr)
}
func udpEndpoint(addr net.Addr) (netip.AddrPort, bool) {
	udp, ok := addr.(*net.UDPAddr)
	if !ok {
		return netip.AddrPort{}, false
	}
	endpoint := udp.AddrPort()
	return netip.AddrPortFrom(endpoint.Addr().Unmap(), endpoint.Port()), endpoint.Port() != 0
}

func quicConfig(server bool) *quic.Config {
	streams := int64(-1)
	if server {
		streams = 4
	}
	return &quic.Config{
		HandshakeIdleTimeout:       900 * time.Millisecond,
		MaxIdleTimeout:             60 * time.Second,
		KeepAlivePeriod:            15 * time.Second,
		MaxIncomingStreams:         streams,
		MaxIncomingUniStreams:      -1,
		RequireStreamCreditRelease: server,
		MaxStreamReceiveWindow:     512 * 1024,
		MaxConnectionReceiveWindow: 2 * 1024 * 1024,
	}
}

type QUICListener struct {
	listener     *quic.Listener
	transport    *quic.Transport
	socket       net.PacketConn
	current      atomic.Pointer[[]networking.Interface]
	inventory    func() ([]networking.Interface, error)
	name         string
	source       netip.Addr
	index        int
	trusted      func(string) (bool, error)
	receiver     *drop.Receiver
	services     bridge.Lookup
	mountReg         *mount.Registry
	mountAllowed     func(string, string) bool
	clipboardBuf     *clipboard.Buffer
	clipboardAllowed func(string) bool
	closeOnce        sync.Once
}

func ListenQUIC(ctx context.Context, name string, bind netip.AddrPort, key ed25519.PrivateKey,
	inventory func() ([]networking.Interface, error), trusted func(string) (bool, error), receiver *drop.Receiver, services bridge.Lookup) (*QUICListener, error) {
	interfaces, err := inventory()
	if err != nil {
		return nil, err
	}
	index := networking.ListenerIndex(interfaces, name, bind.Addr())
	if index == 0 || trusted == nil {
		return nil, ErrPeerScope
	}
	identity, err := identityTLS(key)
	if err != nil {
		return nil, err
	}
	config := net.ListenConfig{Control: bindInterface(index)}
	socket, err := config.ListenPacket(ctx, "udp4", bind.String())
	if err != nil {
		return nil, err
	}
	result := &QUICListener{socket: socket, inventory: inventory, name: name, source: bind.Addr(), index: index, trusted: trusted, receiver: receiver, services: services}
	result.current.Store(&interfaces)
	result.transport = &quic.Transport{
		Conn:                scopedPackets{PacketConn: socket, permitted: result.allowedPacket},
		VerifySourceAddress: func(net.Addr) bool { return true },
	}
	protocols := []string{quicTrustedProtocol}
	if receiver != nil {
		protocols = append(protocols, drop.Protocol)
	}
	if services != nil {
		protocols = append(protocols, bridge.Protocol)
	}
	protocols = append(protocols, mount.Protocol, clipboard.Protocol)
	result.listener, err = result.transport.Listen(trustedProtocolsTLS(identity, protocols, trusted), quicConfig(true))
	if err != nil {
		result.Close()
		return nil, err
	}
	return result, nil
}

// EnableClipboard attaches a shared clipboard buffer and authorization callback to the QUIC listener.
func (l *QUICListener) EnableClipboard(buf *clipboard.Buffer, allowed func(string) bool) {
	l.clipboardBuf = buf
	l.clipboardAllowed = allowed
}

// EnableMount attaches a Live Resources registry and authorization callback to the QUIC listener.
func (l *QUICListener) EnableMount(reg *mount.Registry, allowed func(fingerprint, mountID string) bool) {
	l.mountReg = reg
	l.mountAllowed = allowed
}

func (l *QUICListener) allowedPacket(endpoint netip.AddrPort) bool {
	snapshot := l.current.Load()
	if snapshot == nil {
		return false
	}
	decision := networking.CheckScope(*snapshot, l.name, endpoint.Addr())
	return decision.Allowed && decision.Source == l.source.String()
}

func (l *QUICListener) refresh() bool {
	interfaces, err := l.inventory()
	if err != nil || networking.ListenerIndex(interfaces, l.name, l.source) != l.index {
		l.current.Store(nil)
		return false
	}
	l.current.Store(&interfaces)
	return true
}

func (l *QUICListener) Close() {
	l.closeOnce.Do(func() {
		l.current.Store(nil)
		if l.listener != nil {
			l.listener.Close()
		}
		l.transport.Close()
		l.socket.Close()
	})
}

func (l *QUICListener) Serve(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	var sessions sync.WaitGroup
	watcher := make(chan struct{})
	go func() {
		defer close(watcher)
		tick := time.NewTicker(quicScopesRefresh)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if !l.refresh() {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		cancel()
		<-watcher
		l.Close()
		sessions.Wait()
	}()
	slots := make(chan struct{}, 16)
	for {
		conn, err := l.listener.Accept(ctx)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		select {
		case slots <- struct{}{}:
			sessions.Go(func() {
				defer func() { <-slots }()
				l.serveConnection(ctx, conn)
			})
		default:
			conn.CloseWithError(1, "server busy")
		}
	}
}

func (l *QUICListener) serveConnection(ctx context.Context, conn *quic.Conn) {
	endpoint, ok := udpEndpoint(conn.RemoteAddr())
	if !ok {
		conn.CloseWithError(1, "invalid endpoint")
		return
	}
	defer conn.CloseWithError(0, "session closed")
	scope := func() bool {
		current, ok := udpEndpoint(conn.RemoteAddr())
		return ok && current == endpoint && l.refresh() && l.allowedPacket(current)
	}
	if !scope() {
		return
	}
	serveQUICStreamsWithClipboard(ctx, conn, l.trusted, scope, l.receiver, l.services, l.mountReg, l.mountAllowed, l.clipboardBuf, l.clipboardAllowed)
}

func serveQUICStreams(ctx context.Context, conn *quic.Conn, trusted func(string) (bool, error), scope func() bool,
	receiver *drop.Receiver, services bridge.Lookup) {
	serveQUICStreamsWithClipboard(ctx, conn, trusted, scope, receiver, services, nil, nil, nil, nil)
}

func serveQUICStreamsWithMount(ctx context.Context, conn *quic.Conn, trusted func(string) (bool, error), scope func() bool,
	receiver *drop.Receiver, services bridge.Lookup, mountReg *mount.Registry, mountAllowed func(string, string) bool) {
	serveQUICStreamsWithClipboard(ctx, conn, trusted, scope, receiver, services, mountReg, mountAllowed, nil, nil)
}

func serveQUICStreamsWithClipboard(ctx context.Context, conn *quic.Conn, trusted func(string) (bool, error), scope func() bool,
	receiver *drop.Receiver, services bridge.Lookup, mountReg *mount.Registry, mountAllowed func(string, string) bool,
	clipboardBuf *clipboard.Buffer, clipboardAllowed func(string) bool) {
	state := conn.ConnectionState().TLS
	protocol := state.NegotiatedProtocol
	if protocol != quicTrustedProtocol &&
		!(protocol == drop.Protocol && receiver != nil) &&
		!(protocol == bridge.Protocol && services != nil) &&
		!(protocol == mount.Protocol && mountReg != nil) &&
		!(protocol == clipboard.Protocol && clipboardBuf != nil) {
		return
	}
	pin, err := certificateFingerprint(state, protocol)
	if err != nil {
		return
	}
	fingerprint := pin.String()
	var streams sync.WaitGroup
	defer streams.Wait()
	for {
		stream, err := conn.AcceptStream(ctx)
		if err != nil {
			return
		}
		streams.Go(func() {
			defer stream.ReleaseStreamCredit()
			if !scope() {
				stream.CancelRead(1)
				stream.CancelWrite(1)
				return
			}
			if authorized, err := trusted(fingerprint); err != nil || !authorized {
				stream.CancelRead(1)
				stream.CancelWrite(1)
				return
			}
			wire := &quicStreamConn{Stream: stream, connection: conn}
			if protocol == quicTrustedProtocol {
				verifyIncomingQUICStream(stream, scope, trusted, fingerprint)
				return
			}
			streamCtx, cancel := context.WithCancel(ctx)
			stop := context.AfterFunc(conn.Context(), cancel)
			defer cancel()
			defer stop()
			var err error
			if protocol == drop.Protocol {
				err = receiver.ReceiveStream(streamCtx, wire, fingerprint, scope)
			} else if protocol == mount.Protocol {
				err = serveMountConn(streamCtx, wire, fingerprint, mountReg, mountAllowed, scope)
			} else if protocol == clipboard.Protocol {
				err = serveClipboardConn(streamCtx, wire, fingerprint, clipboardBuf, clipboardAllowed)
			} else {
				err = bridge.Serve(streamCtx, wire, fingerprint, services, scope)
			}
			if err != nil {
				wire.Close()
				return
			}
			stream.CancelRead(0)
			stream.Close()
		})
	}
}

func verifyIncomingQUICStream(stream *quic.Stream, scope func() bool, trusted func(string) (bool, error), fingerprint string) {
	stream.SetDeadline(time.Now().Add(2 * time.Second))
	var challenge [1]byte
	if _, err := io.ReadFull(stream, challenge[:]); err != nil || challenge[0] != quicChallenge || !scope() {
		stream.CancelRead(1)
		stream.CancelWrite(1)
		return
	}
	if authorized, err := trusted(fingerprint); err != nil || !authorized {
		stream.CancelRead(1)
		stream.CancelWrite(1)
		return
	}
	stream.CancelRead(0)
	if _, err := stream.Write([]byte{accepted}); err != nil {
		stream.CancelWrite(1)
		return
	}
	stream.Close()
}

func VerifyQUIC(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	inventory func() ([]networking.Interface, error), key ed25519.PrivateKey) error {
	before, err := inventory()
	if err != nil {
		return err
	}
	selected, selectedIndex := endpointScope(before, adapter, endpoint)
	if selectedIndex == 0 {
		return ErrPeerScope
	}
	config, err := clientIdentity(expected, key, quicTrustedProtocol)
	if err != nil {
		return err
	}
	conn, closeSession, err := openQUICSession(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return err
	}
	defer closeSession()
	if err := verifyQUICStream(ctx, conn); err != nil {
		return err
	}
	interfaces, err := inventory()
	if err != nil {
		return err
	}
	source, index := endpointScope(interfaces, adapter, endpoint)
	local, ok := udpEndpoint(conn.LocalAddr())
	if !ok || index != selectedIndex || source != selected || source != local.Addr() {
		return ErrPeerScope
	}
	return nil
}

func openQUICSession(ctx context.Context, adapter string, endpoint netip.AddrPort, inventory func() ([]networking.Interface, error),
	config *tls.Config) (*quic.Conn, func(), error) {
	interfaces, err := inventory()
	if err != nil {
		return nil, nil, err
	}
	source, index := endpointScope(interfaces, adapter, endpoint)
	if index == 0 {
		return nil, nil, ErrPeerScope
	}
	packet := net.ListenConfig{Control: bindInterface(index)}
	socket, err := packet.ListenPacket(ctx, "udp4", netip.AddrPortFrom(source, 0).String())
	if err != nil {
		return nil, nil, err
	}
	transport := quic.Transport{Conn: scopedPackets{PacketConn: socket, permitted: func(addr netip.AddrPort) bool { return addr == endpoint }}}
	conn, err := dialQUIC(ctx, &transport, endpoint, config)
	closeSession := func() {
		if conn != nil {
			conn.CloseWithError(0, "session closed")
		}
		transport.Close()
		socket.Close()
	}
	if err != nil {
		closeSession()
		return nil, nil, err
	}
	interfaces, err = inventory()
	if err != nil {
		closeSession()
		return nil, nil, err
	}
	current, currentIndex := endpointScope(interfaces, adapter, endpoint)
	if current != source || currentIndex != index {
		closeSession()
		return nil, nil, ErrPeerScope
	}
	return conn, closeSession, nil
}

func dialQUIC(ctx context.Context, transport *quic.Transport, endpoint netip.AddrPort, config *tls.Config) (*quic.Conn, error) {
	conn, err := transport.Dial(ctx, net.UDPAddrFromAddrPort(endpoint), config, quicConfig(false))
	if err != nil {
		var handshake *quic.HandshakeTimeoutError
		var idle *quic.IdleTimeoutError
		// Dial returns only after a full handshake. A silent socket can
		// report either timeout type here, depending on retransmission state.
		if errors.As(err, &handshake) || errors.As(err, &idle) {
			return nil, ErrQUICUnreachable
		}
	}
	return conn, err
}

func verifyQUICStream(ctx context.Context, conn *quic.Conn) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stream, err := conn.OpenStreamSync(ctx)
	if err != nil {
		return err
	}
	defer stream.CancelRead(0)
	deadline, _ := ctx.Deadline()
	if err := stream.SetDeadline(deadline); err != nil {
		return err
	}
	if _, err := stream.Write([]byte{quicChallenge}); err != nil {
		stream.CancelWrite(1)
		return err
	}
	if err := stream.Close(); err != nil {
		return err
	}
	var marker [1]byte
	if _, err := io.ReadFull(stream, marker[:]); err != nil || marker[0] != accepted {
		return ErrPeerIdentity
	}
	return nil
}

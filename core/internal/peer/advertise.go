package peer

import (
	"context"
	"errors"
	"net"
	"net/netip"

	"lanvory.local/core/internal/discovery"
)

// ServeAdvertised ties the Bonjour registration to the peer socket lifetime.
func (l *Listener) ServeAdvertised(ctx context.Context, label string, ready func()) error {
	if !l.currentScope(netip.Addr{}) {
		l.Close()
		return errors.New("peer listener scope is no longer approved")
	}
	port := netip.MustParseAddrPort(l.Addr().String()).Port()
	return serveAdvertised(ctx, l.Serve, l.index, label, port, "tcp", ready)
}

func (l *QUICListener) ServeAdvertised(ctx context.Context, label string, ready func()) error {
	if !l.refresh() {
		l.Close()
		return ErrPeerScope
	}
	port := l.socket.LocalAddr().(*net.UDPAddr).AddrPort().Port()
	return serveAdvertised(ctx, l.Serve, l.index, label, port, "udp", ready)
}

func serveAdvertised(ctx context.Context, serve func(context.Context) error, index int, label string, port uint16, transport string, ready func()) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, 2)
	go func() { results <- serve(ctx) }()
	go func() { results <- discovery.Publish(ctx, index, label, port, transport, ready) }()
	first := <-results
	cancel()
	second := <-results
	if errors.Is(first, context.Canceled) {
		first = nil
	}
	if errors.Is(second, context.Canceled) {
		second = nil
	}
	return errors.Join(first, second)
}

package peer

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go"

	"lanvory.local/core/internal/networking"
)

// quicStreamConn presents one QUIC bidirectional stream to the application
// protocols. Close cancels blocked operations; CloseWrite sends a graceful FIN.
type quicStreamConn struct {
	*quic.Stream
	connection   *quic.Conn
	closeSession func()
	closeOnce    sync.Once
	writeClosed  atomic.Bool
}

func (s *quicStreamConn) LocalAddr() net.Addr  { return s.connection.LocalAddr() }
func (s *quicStreamConn) RemoteAddr() net.Addr { return s.connection.RemoteAddr() }
func (s *quicStreamConn) CloseWrite() error {
	err := s.Stream.Close()
	if err == nil {
		s.writeClosed.Store(true)
	}
	return err
}
func (s *quicStreamConn) Close() error {
	s.closeOnce.Do(func() {
		s.CancelRead(1)
		if !s.writeClosed.Load() {
			s.CancelWrite(1)
		}
		if s.closeSession != nil {
			s.closeSession()
		}
	})
	return nil
}

func dialResource(ctx context.Context, adapter string, endpoint netip.AddrPort,
	inventory func() ([]networking.Interface, error), config *tls.Config) (net.Conn, error) {
	connection, closeSession, err := openQUICSession(ctx, adapter, endpoint, inventory, config)
	if errors.Is(err, ErrQUICUnreachable) {
		return dialScoped(ctx, adapter, endpoint, inventory, config)
	}
	if err != nil {
		return nil, err
	}
	openCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stream, err := connection.OpenStreamSync(openCtx)
	if err != nil {
		closeSession()
		return nil, err
	}
	return &quicStreamConn{Stream: stream, connection: connection, closeSession: closeSession}, nil
}

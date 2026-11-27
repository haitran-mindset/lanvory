package peer

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/netip"
	"slices"
	"sync"
	"time"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/screenshare"
)

func SendScreenSignal(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, request screenshare.Request, inventory func() ([]networking.Interface, error)) (screenshare.Reply, error) {
	return sendScreenSignal(ctx, 2*time.Second, expected, key, request, func(ctx context.Context, config *tls.Config) (net.Conn, error) {
		return dialScoped(ctx, adapter, endpoint, inventory, config)
	})
}

// SendScreenSignalLoopback uses a registered Wi-Fi P2P bridge endpoint.
func SendScreenSignalLoopback(ctx context.Context, endpoint netip.AddrPort, expected Fingerprint,
	key ed25519.PrivateKey, request screenshare.Request, hasEndpoint func(string) bool) (screenshare.Reply, error) {
	timeout := 2 * time.Second
	if request.Action == "offer" {
		timeout = 6 * time.Second
	}
	return sendScreenSignal(ctx, timeout, expected, key, request, func(ctx context.Context, config *tls.Config) (net.Conn, error) {
		return dialLoopback(ctx, endpoint, config, hasEndpoint)
	})
}

func sendScreenSignal(ctx context.Context, timeout time.Duration, expected Fingerprint, key ed25519.PrivateKey, request screenshare.Request,
	dial func(context.Context, *tls.Config) (net.Conn, error)) (screenshare.Reply, error) {
	var reply screenshare.Reply
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	config, err := clientIdentity(expected, key, screenshare.Protocol)
	if err != nil {
		return reply, err
	}
	conn, err := dial(ctx, config)
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
	return checkedScreenReply(reply)
}

func checkedScreenReply(reply screenshare.Reply) (screenshare.Reply, error) {
	switch reply.State {
	case "pending", "declined", "stopped":
		if reply.Answer == "" {
			return reply, nil
		}
	case "accepted":
		if reply.Answer != "" && len(reply.Answer) <= screenshare.MaxDescription {
			return reply, nil
		}
	case "unavailable":
		return screenshare.Reply{}, screenshare.ErrUnavailable
	}
	return screenshare.Reply{}, screenshare.ErrUnavailable
}

// EnableScreenSignaling opts an already scoped TCP listener into screen invitations.
func (l *Listener) EnableScreenSignaling(manager *screenshare.Manager) {
	if l == nil || l.trusted == nil || manager == nil {
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
	reader := bufio.NewReader(session)
	first, err := reader.Peek(1)
	if err != nil {
		return
	}
	binaryMedia := first[0] == screenFrameMarker
	input := bufio.NewScanner(reader)
	input.Buffer(make([]byte, 4096), screenshare.MaxMessage)
	output := json.NewEncoder(session)
	var streamID string
	for {
		var request screenshare.Request
		if binaryMedia {
			request, err = readScreenFrame(reader)
		} else if input.Scan() {
			err = json.Unmarshal(input.Bytes(), &request)
		} else {
			return
		}
		if err != nil || (streamID != "" && (request.ID != streamID || request.Action != "frame" || !request.Stream)) {
			return
		}
		// The request may have arrived while blocked on the socket.
		trusted, err := l.trusted(pin.String())
		if err != nil || !trusted || !l.currentScope(remote) {
			return
		}
		reply, err := l.screenSignaling.Handle(pin.String(), request)
		if err != nil {
			reply = screenshare.Reply{State: "unavailable"}
		}
		if request.Action == "status" && reply.State == "accepted" {
			reply.Stream = true
			reply.Binary = true
		}
		if output.Encode(reply) != nil || request.Action != "frame" || !request.Stream || reply.State != "accepted" {
			return
		}
		streamID = request.ID
		if session.SetDeadline(time.Now().Add(2*time.Second)) != nil {
			return
		}
	}
}

// ScreenFrameStream keeps at most one authenticated outgoing media connection.
type ScreenFrameStream struct {
	mu       sync.Mutex
	conn     net.Conn
	input    *bufio.Scanner
	timer    *time.Timer
	revision uint64
	adapter  string
	endpoint netip.AddrPort
	pin      Fingerprint
	id       string
	index    int
	binary   bool
}

func (s *ScreenFrameStream) close() {
	s.revision++
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
		s.input = nil
	}
}

func (s *ScreenFrameStream) Stop(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.id == id {
		s.close()
	}
}

func (s *ScreenFrameStream) Send(ctx context.Context, adapter string, endpoint netip.AddrPort, pin Fingerprint,
	key ed25519.PrivateKey, request screenshare.Request, inventory func() ([]networking.Interface, error),
	hasEndpoint func(string) bool) (screenshare.Reply, error) {
	if request.Action != "frame" || !request.Stream {
		return screenshare.Reply{}, screenshare.ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter != adapter || s.endpoint != endpoint || s.pin != pin || s.id != request.ID || s.binary != request.Binary {
		s.close()
	}

	var source netip.Addr
	var index int
	if adapter == "p2p" {
		if hasEndpoint == nil || !hasEndpoint(endpoint.String()) {
			s.close()
			return screenshare.Reply{}, ErrPeerScope
		}
	} else {
		interfaces, err := inventory()
		if err != nil {
			s.close()
			return screenshare.Reply{}, err
		}
		source, index = endpointScope(interfaces, adapter, endpoint)
		if index == 0 || (s.conn != nil && (s.index != index || s.conn.LocalAddr().(*net.TCPAddr).AddrPort().Addr().Unmap() != source)) {
			s.close()
			return screenshare.Reply{}, ErrPeerScope
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	if s.conn == nil {
		config, err := clientIdentity(pin, key, screenshare.Protocol)
		if err != nil {
			return screenshare.Reply{}, err
		}
		var conn net.Conn
		if adapter == "p2p" {
			conn, err = dialLoopback(ctx, endpoint, config, hasEndpoint)
		} else {
			conn, err = dialScoped(ctx, adapter, endpoint, inventory, config)
		}
		if err != nil {
			return screenshare.Reply{}, err
		}
		s.conn = conn
		s.input = bufio.NewScanner(conn)
		s.input.Buffer(make([]byte, 4096), 16*1024)
		s.adapter, s.endpoint, s.pin, s.id, s.index = adapter, endpoint, pin, request.ID, index
		s.binary = request.Binary
	}
	deadline, _ := ctx.Deadline()
	if err := s.conn.SetDeadline(deadline); err != nil {
		s.close()
		return screenshare.Reply{}, err
	}
	var writeErr error
	if request.Binary {
		writeErr = writeScreenFrame(s.conn, request)
	} else {
		writeErr = json.NewEncoder(s.conn).Encode(request)
	}
	if writeErr != nil {
		s.close()
		return screenshare.Reply{}, writeErr
	}
	var reply screenshare.Reply
	if !s.input.Scan() || json.Unmarshal(s.input.Bytes(), &reply) != nil {
		s.close()
		return screenshare.Reply{}, io.ErrUnexpectedEOF
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	reply, err := checkedScreenReply(reply)
	if err != nil || reply.State != "accepted" {
		s.close()
		return reply, err
	}
	s.revision++
	revision := s.revision
	s.timer = time.AfterFunc(1500*time.Millisecond, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.revision == revision {
			s.close()
		}
	})
	return reply, nil
}

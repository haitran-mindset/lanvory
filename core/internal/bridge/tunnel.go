package bridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/netip"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const maxTunnels = 8

var ErrTunnelLimit = errors.New("local tunnel limit reached")
var ErrTunnelNotFound = errors.New("local tunnel not found")

type Tunnel struct {
	ID          string         `json:"id"`
	Service     string         `json:"service"`
	Bind        netip.AddrPort `json:"bind"`
	Connections int32          `json:"connections"`
}

type tunnelSession struct {
	info   Tunnel
	active atomic.Int32
	cancel context.CancelFunc
	done   chan struct{}
}

type Tunnels struct {
	mu      sync.Mutex
	entries map[string]*tunnelSession
	closed  bool
}

func NewTunnels() *Tunnels { return &Tunnels{entries: make(map[string]*tunnelSession)} }

func (t *Tunnels) Open(ctx context.Context, bind netip.AddrPort, service string,
	connect func(context.Context) (net.Conn, error), allowed func() bool) (Tunnel, error) {
	if !ValidBind(bind) || !ValidID(service) || !allowed() {
		return Tunnel{}, ErrNotAvailable
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return Tunnel{}, net.ErrClosed
	}
	if len(t.entries) >= maxTunnels {
		return Tunnel{}, ErrTunnelLimit
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return Tunnel{}, err
	}
	id := hex.EncodeToString(nonce[:])
	if _, exists := t.entries[id]; exists {
		return Tunnel{}, ErrTunnelLimit
	}
	var config net.ListenConfig
	listener, err := config.Listen(ctx, "tcp", bind.String())
	if err != nil {
		return Tunnel{}, err
	}
	if !allowed() || ctx.Err() != nil {
		listener.Close()
		return Tunnel{}, ErrNotAvailable
	}
	activeCtx, cancel := context.WithCancel(context.Background())
	info := Tunnel{ID: id, Service: service, Bind: listener.Addr().(*net.TCPAddr).AddrPort()}
	session := &tunnelSession{info: info, cancel: cancel, done: make(chan struct{})}
	t.entries[id] = session
	go func() {
		defer close(session.done)
		defer func() {
			t.mu.Lock()
			delete(t.entries, id)
			t.mu.Unlock()
		}()
		serveTunnel(activeCtx, cancel, listener, session, connect, allowed)
	}()
	return info, nil
}

func serveTunnel(ctx context.Context, cancel context.CancelFunc, listener net.Listener, session *tunnelSession,
	connect func(context.Context) (net.Conn, error), allowed func() bool) {
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	watcher := make(chan struct{})
	go func() {
		defer close(watcher)
		tick := time.NewTicker(500 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if !allowed() {
					cancel()
					return
				}
			}
		}
	}()
	slots := make(chan struct{}, 32)
	var connections sync.WaitGroup
	defer func() {
		cancel()
		listener.Close()
		<-watcher
		connections.Wait()
	}()
	for {
		local, err := listener.Accept()
		if err != nil {
			return
		}
		select {
		case slots <- struct{}{}:
		default:
			local.Close()
			continue
		}
		session.active.Add(1)
		connections.Go(func() {
			defer func() { local.Close(); session.active.Add(-1); <-slots }()
			if ctx.Err() != nil || !allowed() {
				return
			}
			request, finish := context.WithTimeout(ctx, sessionLimit)
			defer finish()
			remote, err := connect(request)
			if err != nil {
				return
			}
			defer abort(remote)
			if !allowed() {
				return
			}
			Forward(request, local, remote)
		})
	}
}

func (t *Tunnels) List() []Tunnel {
	t.mu.Lock()
	defer t.mu.Unlock()
	tunnels := make([]Tunnel, 0, len(t.entries))
	for _, entry := range t.entries {
		info := entry.info
		info.Connections = entry.active.Load()
		tunnels = append(tunnels, info)
	}
	sort.Slice(tunnels, func(i, j int) bool { return tunnels[i].ID < tunnels[j].ID })
	return tunnels
}

func (t *Tunnels) Stop(ctx context.Context, id string) error {
	t.mu.Lock()
	entry, ok := t.entries[id]
	t.mu.Unlock()
	if !ok {
		return ErrTunnelNotFound
	}
	entry.cancel()
	select {
	case <-entry.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (t *Tunnels) Close() {
	t.mu.Lock()
	t.closed = true
	entries := make([]*tunnelSession, 0, len(t.entries))
	for _, entry := range t.entries {
		entry.cancel()
		entries = append(entries, entry)
	}
	t.mu.Unlock()
	for _, entry := range entries {
		<-entry.done
	}
}

// Request opens one resource stream on an already authenticated connection.
func Request(ctx context.Context, remote net.Conn, id string) error {
	if !ValidID(id) {
		return ErrNotAvailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline := time.Now().Add(3 * time.Second)
	if until, ok := ctx.Deadline(); ok && until.Before(deadline) {
		deadline = until
	}
	if err := remote.SetDeadline(deadline); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { abort(remote) })
	defer stop()
	payload := append([]byte{byte(len(id))}, id...)
	if n, err := remote.Write(payload); err != nil {
		return err
	} else if n != len(payload) {
		return io.ErrShortWrite
	}
	var marker [1]byte
	if _, err := io.ReadFull(remote, marker[:]); err != nil || marker[0] != Ready {
		return ErrNotAvailable
	}
	return remote.SetDeadline(time.Time{})
}

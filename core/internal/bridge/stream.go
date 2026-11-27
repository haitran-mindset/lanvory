package bridge

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/netip"
	"time"
)

const Ready byte = 1
const sessionLimit = 30 * time.Minute

type Lookup func(fingerprint, id string) (Service, error)
type ListLookup func(fingerprint string) ([]string, error)

// Serve serves one request over an already authenticated peer connection.
func Serve(ctx context.Context, remote net.Conn, fingerprint string, lookup Lookup, scope func() bool) error {
	return ServeWithDiscovery(ctx, remote, fingerprint, lookup, nil, scope)
}

// ServeWithDiscovery serves one request or discovery probe over an authenticated peer connection.
func ServeWithDiscovery(ctx context.Context, remote net.Conn, fingerprint string, lookup Lookup, list ListLookup, scope func() bool) error {
	ctx, cancel := context.WithTimeout(ctx, sessionLimit)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { abort(remote) })
	defer stop()
	if err := remote.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return err
	}
	var length [1]byte
	if _, err := io.ReadFull(remote, length[:]); err != nil {
		return err
	}
	if length[0] == 0 {
		if list == nil || !scope() {
			_, _ = remote.Write([]byte{0})
			return ErrNotAvailable
		}
		ids, err := list(fingerprint)
		if err != nil {
			_, _ = remote.Write([]byte{0})
			return err
		}
		raw, err := json.Marshal(ids)
		if err != nil || len(raw) > 1024*1024 {
			_, _ = remote.Write([]byte{0})
			return ErrNotAvailable
		}
		var hdr [5]byte
		hdr[0] = Ready
		binary.BigEndian.PutUint32(hdr[1:], uint32(len(raw)))
		if _, err := remote.Write(hdr[:]); err != nil {
			return err
		}
		_, err = remote.Write(raw)
		return err
	}
	if length[0] > 64 {
		return ErrNotAvailable
	}
	rawID := make([]byte, int(length[0]))
	if _, err := io.ReadFull(remote, rawID); err != nil {
		return err
	}
	id := string(rawID)
	if !ValidID(id) || !scope() {
		return ErrNotAvailable
	}
	service, err := lookup(fingerprint, id)
	if err != nil || service.ID != id || !ValidTarget(service.Target) {
		return ErrNotAvailable
	}

	dialer := net.Dialer{Timeout: 2 * time.Second}
	target, err := dialer.DialContext(ctx, "tcp", service.Target.String())
	if err != nil && service.Target.Addr() == netip.MustParseAddr("127.0.0.1") {
		alt := netip.AddrPortFrom(netip.MustParseAddr("::1"), service.Target.Port())
		if altConn, altErr := dialer.DialContext(ctx, "tcp", alt.String()); altErr == nil {
			target = altConn
			err = nil
		}
	}
	if err != nil {
		return err
	}
	defer target.Close()
	current := func() bool {
		if !scope() {
			return false
		}
		observed, err := lookup(fingerprint, id)
		return err == nil && observed == service
	}
	if !current() {
		return ErrNotAvailable
	}
	if _, err := remote.Write([]byte{Ready}); err != nil {
		return err
	}
	if err := remote.SetDeadline(time.Time{}); err != nil {
		return err
	}

	checked := make(chan struct{})
	go func() {
		defer close(checked)
		tick := time.NewTicker(500 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if !current() {
					cancel()
					return
				}
			}
		}
	}()
	Forward(ctx, remote, target)
	stop()
	cancel()
	<-checked
	return nil
}

// DiscoverServices queries which shared service IDs a peer has granted to this device.
func DiscoverServices(ctx context.Context, remote net.Conn) ([]string, error) {
	deadline := time.Now().Add(5 * time.Second)
	if until, ok := ctx.Deadline(); ok && until.Before(deadline) {
		deadline = until
	}
	if err := remote.SetDeadline(deadline); err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { abort(remote) })
	defer stop()
	if _, err := remote.Write([]byte{0}); err != nil {
		return nil, err
	}
	var status [1]byte
	if _, err := io.ReadFull(remote, status[:]); err != nil {
		return nil, err
	}
	if status[0] != Ready {
		return nil, ErrNotAvailable
	}
	var sizeBuf [4]byte
	if _, err := io.ReadFull(remote, sizeBuf[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(sizeBuf[:])
	if size > 1024*1024 {
		return nil, ErrNotAvailable
	}
	raw := make([]byte, int(size))
	if _, err := io.ReadFull(remote, raw); err != nil {
		return nil, err
	}
	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

// Forward relays a single TCP session, preserving half-closes when supported.
func Forward(ctx context.Context, a, b net.Conn) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { abort(a); abort(b) })
	defer stop()
	done := make(chan struct{}, 2)
	copyStream := func(dst, src net.Conn) {
		defer func() { done <- struct{}{} }()
		if _, err := io.Copy(dst, src); err != nil {
			cancel()
			return
		}
		if half, ok := dst.(interface{ CloseWrite() error }); ok {
			if err := half.CloseWrite(); err != nil {
				cancel()
			}
		} else {
			cancel()
		}
	}
	go copyStream(a, b)
	go copyStream(b, a)
	<-done
	<-done
}

// Cancellation closes the raw transport without waiting for TLS close_notify.
func abort(conn net.Conn) {
	if secured, ok := conn.(interface{ NetConn() net.Conn }); ok {
		conn = secured.NetConn()
	}
	conn.Close()
}

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/networking"
)

const (
	mountHeaderID     = "X-Lanvory-Mount-ID"
	mountControlRes   = "/_lanvory/resources"
	mountControlEvent = "/_lanvory/events"
)

// EnableMount attaches a Live Resources registry and per-peer authorization
// callback to the listener for the lanvory-mount/1 ALPN protocol.
func (l *Listener) EnableMount(reg *mount.Registry, allowed func(fingerprint, mountID string) bool) {
	l.mountReg = reg
	l.mountAllowed = allowed
	prev := l.config.GetConfigForClient
	l.config.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if slices.Contains(hello.SupportedProtos, mount.Protocol) {
			return trustedTLS(l.config, mount.Protocol, l.trusted), nil
		}
		if prev != nil {
			return prev(hello)
		}
		return nil, nil
	}
}

type singleConnListener struct {
	conn   net.Conn
	addr   net.Addr
	once   sync.Once
	closed chan struct{}
}

type plainConn struct {
	net.Conn
}

func newSingleConnListener(conn net.Conn) *singleConnListener {
	return &singleConnListener{
		conn:   plainConn{Conn: conn},
		addr:   conn.LocalAddr(),
		closed: make(chan struct{}),
	}
}

func (s *singleConnListener) Accept() (net.Conn, error) {
	var c net.Conn
	s.once.Do(func() {
		c = s.conn
	})
	if c != nil {
		return c, nil
	}
	<-s.closed
	return nil, net.ErrClosed
}

func (s *singleConnListener) Close() error {
	select {
	case <-s.closed:
	default:
		close(s.closed)
	}
	return nil
}

func (s *singleConnListener) Addr() net.Addr {
	return s.addr
}

type eventPollResponse struct {
	Seq    uint64                `json:"seq"`
	Events []mount.ResourceEvent `json:"events"`
}

func serveMountConn(
	ctx context.Context,
	conn net.Conn,
	fingerprint string,
	reg *mount.Registry,
	allowed func(string, string) bool,
	inScope func() bool,
) error {
	ln := newSingleConnListener(conn)
	defer ln.Close()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if inScope != nil && !inScope() {
			http.Error(w, "peer out of scope", http.StatusForbidden)
			return
		}

		// Control plane: Resource Discovery (only authorized resources are returned).
		if r.URL.Path == mountControlRes && r.Method == http.MethodGet {
			list := reg.DescribeAuthorized(func(id string) bool {
				return allowed == nil || allowed(fingerprint, id)
			})
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(list)
			return
		}

		// Control plane: Resource Event Engine + Reconciliation.
		if r.URL.Path == mountControlEvent && r.Method == http.MethodGet {
			resID := strings.TrimSpace(r.URL.Query().Get("resource"))
			since, _ := strconv.ParseUint(r.URL.Query().Get("since"), 10, 64)
			if resID != "" && allowed != nil && !allowed(fingerprint, resID) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(eventPollResponse{
					Seq: since,
					Events: []mount.ResourceEvent{{
						Seq:        since + 1,
						Type:       "permission.revoked",
						ResourceID: resID,
						Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
					}},
				})
				return
			}
			if resID != "" {
				if exp, ok := reg.Get(resID); ok {
					reg.Events().Reconcile(exp)
				}
			}
			seq, events := reg.Events().Since(resID, since)
			if resID == "" && allowed != nil {
				filtered := events[:0]
				for _, ev := range events {
					if allowed(fingerprint, ev.ResourceID) {
						filtered = append(filtered, ev)
					}
				}
				events = filtered
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(eventPollResponse{Seq: seq, Events: events})
			return
		}

		mountID := strings.TrimSpace(r.Header.Get(mountHeaderID))
		if mountID == "" {
			http.Error(w, "missing resource id", http.StatusBadRequest)
			return
		}
		if allowed != nil && !allowed(fingerprint, mountID) {
			http.Error(w, "resource access denied", http.StatusForbidden)
			return
		}
		exp, ok := reg.Get(mountID)
		if !ok {
			http.NotFound(w, r)
			return
		}
		mount.ServeExport(exp).ServeHTTP(w, r)
	})

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	err := srv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}

// DiscoverResources queries a paired peer over lanvory-mount/1 for all resources
// that the peer has authorized for this device.
func DiscoverResources(
	ctx context.Context,
	adapter string,
	endpoint netip.AddrPort,
	expected Fingerprint,
	key ed25519.PrivateKey,
	inventory func() ([]networking.Interface, error),
) ([]mount.ResourceDescriptor, error) {
	tlsConfig, err := clientIdentity(expected, key, mount.Protocol)
	if err != nil {
		return nil, err
	}
	return discoverResources(ctx, func(dialCtx context.Context) (net.Conn, error) {
		return dialResource(dialCtx, adapter, endpoint, inventory, tlsConfig)
	})
}

func discoverResources(
	ctx context.Context,
	dial func(context.Context) (net.Conn, error),
) ([]mount.ResourceDescriptor, error) {
	tr := &http.Transport{
		DialContext: func(dialCtx context.Context, _, _ string) (net.Conn, error) {
			return dial(dialCtx)
		},
		DisableKeepAlives: true,
	}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 8 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://lanvory-mount.local"+mountControlRes, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("resource discovery failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var list []mount.ResourceDescriptor
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&list); err != nil {
		return nil, err
	}
	return list, nil
}

// MountSession represents a platform-independent Live Resource Session backed by
// an mTLS peer transport and a loopback WebDAV proxy + bounded stream cache.
type MountSession struct {
	URL       string
	Addr      string
	RemoteID  string
	State     string
	Cache     *mount.StreamCache
	Client    *http.Client
	listener  net.Listener
	server    *http.Server
	transport *http.Transport
	cancel    context.CancelFunc
	done      chan struct{}
}

// StartMountSession starts a local loopback WebDAV HTTP server that proxies all
// WebDAV and HTTP Range requests over lanvory-mount/1 mTLS to a paired peer.
func StartMountSession(
	ctx context.Context,
	adapter string,
	endpoint netip.AddrPort,
	expected Fingerprint,
	key ed25519.PrivateKey,
	remoteMountID string,
	localBind string,
	inventory func() ([]networking.Interface, error),
) (*MountSession, error) {
	tlsConfig, err := clientIdentity(expected, key, mount.Protocol)
	if err != nil {
		return nil, err
	}
	return startMountSession(ctx, remoteMountID, localBind, func(dialCtx context.Context) (net.Conn, error) {
		return dialResource(dialCtx, adapter, endpoint, inventory, tlsConfig)
	})
}

func startMountSession(
	ctx context.Context,
	remoteMountID string,
	localBind string,
	dial func(context.Context) (net.Conn, error),
) (*MountSession, error) {
	if strings.TrimSpace(remoteMountID) == "" {
		return nil, errors.New("remote mount id is required")
	}
	if strings.TrimSpace(localBind) == "" {
		localBind = "127.0.0.1:0"
	}
	ln, err := net.Listen("tcp", localBind)
	if err != nil {
		return nil, err
	}

	sessionCtx, cancel := context.WithCancel(ctx)
	tr := &http.Transport{
		DialContext: func(dialCtx context.Context, _, _ string) (net.Conn, error) {
			return dial(dialCtx)
		},
		MaxIdleConns:       8,
		IdleConnTimeout:    30 * time.Second,
		DisableCompression: true,
	}

	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		outReq := r.Clone(r.Context())
		outReq.RequestURI = ""
		outReq.URL.Scheme = "http"
		outReq.URL.Host = "lanvory-mount.local"
		outReq.Header = r.Header.Clone()
		outReq.Header.Set(mountHeaderID, remoteMountID)

		resp, err := tr.RoundTrip(outReq)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		for k, vals := range resp.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	srv := &http.Server{
		Handler:           proxyHandler,
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return sessionCtx },
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = srv.Serve(ln)
	}()

	addr := ln.Addr().String()
	return &MountSession{
		URL:       "http://" + addr + "/",
		Addr:      addr,
		RemoteID:  remoteMountID,
		State:     "ready",
		Cache:     mount.NewStreamCache(8 * 1024 * 1024),
		Client:    &http.Client{Transport: tr, Timeout: 15 * time.Second},
		listener:  ln,
		server:    srv,
		transport: tr,
		cancel:    cancel,
		done:      done,
	}, nil
}

// PollEvents fetches resource change events (and triggers server-side reconciliation)
// directly over the session's mTLS transport.
func (s *MountSession) PollEvents(ctx context.Context, since uint64) (uint64, []mount.ResourceEvent, error) {
	if s == nil || s.Client == nil {
		return since, nil, errors.New("resource session is closed")
	}
	u := fmt.Sprintf("http://lanvory-mount.local%s?resource=%s&since=%d", mountControlEvent, s.RemoteID, since)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return since, nil, err
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return since, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return since, nil, fmt.Errorf("event poll failed: %d", resp.StatusCode)
	}
	var payload eventPollResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&payload); err != nil {
		return since, nil, err
	}
	for _, ev := range payload.Events {
		if ev.Type == "permission.revoked" {
			s.State = "revoked"
		}
	}
	return payload.Seq, payload.Events, nil
}

// Close shuts down the local loopback WebDAV proxy and closes idle peer connections.
func (s *MountSession) Close() error {
	if s == nil {
		return nil
	}
	s.State = "closed"
	s.cancel()
	_ = s.listener.Close()
	err := s.server.Close()
	s.transport.CloseIdleConnections()
	<-s.done
	return err
}

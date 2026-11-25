//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/discovery"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
	syncengine "lanvory.local/core/internal/sync"
)

func Dir() (string, error) {
	dir := os.Getenv("LANVORY_STATE_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, ".lanvory")
	} else if !filepath.IsAbs(dir) {
		return "", errors.New("LANVORY_STATE_DIR must be absolute")
	}

	if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return "", err
	}
	return dir, checkPrivateDir(dir)
}

func checkPrivateDir(dir string) error {
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode().Perm() != 0700 || !ok || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("Lanvory IPC requires an owner-only directory (0700)")
	}
	return nil
}

func Listen(dir string) (net.Listener, func(), error) {
	if err := checkPrivateDir(dir); err != nil {
		return nil, nil, err
	}
	lock, err := os.OpenFile(filepath.Join(dir, "daemon.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, nil, err
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, nil, fmt.Errorf("acquire daemon lock: %w", err)
	}
	path := filepath.Join(dir, "daemon.sock")
	listener, err := listenUnix(path)
	if err != nil {
		lock.Close()
		return nil, nil, err
	}
	return listener, func() {
		listener.Close()
		lock.Close()
	}, nil
}

func listenUnix(path string) (net.Listener, error) {
	info, err := os.Lstat(path)
	switch {
	case err == nil && info.Mode()&os.ModeSocket == 0:
		return nil, errors.New("daemon socket path is occupied by a non-socket")
	case err == nil:
		if err := os.Remove(path); err != nil {
			return nil, err
		}
	case !errors.Is(err, os.ErrNotExist):
		return nil, err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0600); err != nil {
		listener.Close()
		return nil, err
	}
	return ownerListener{listener}, nil
}

type ownerListener struct {
	*net.UnixListener
}

func (l ownerListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.AcceptUnix()
		if err != nil {
			return nil, err
		}
		if currentUser(conn) {
			return conn, nil
		}
		conn.Close()
	}
}

func currentUser(conn *net.UnixConn) bool {
	raw, err := conn.SyscallConn()
	if err != nil {
		return false
	}
	matched := false
	err = raw.Control(func(fd uintptr) {
		matched = matchesPeerUID(fd, uint32(os.Geteuid()))
	})
	return err == nil && matched
}

const networkRoute = "/v1/network/interfaces"
const scopeRoute = "/v1/network/scope"
const discoveryRoute = "/v1/discovery/scan"
const verifyPeerRoute = "/v1/peer/verify"
const matchTrustedRoute = "/v1/peer/match-trusted"
const verifyTrustedRoute = "/v1/peer/verify-trusted"
const verifyQUICRoute = "/v1/peer/verify-quic"
const trustRoute = "/v1/peers/trust"
const resolveRoute = "/v1/discovery/resolve"

func approvedInventory(dir string) ([]networking.Interface, error) {
	approvals, err := storage.InterfaceApprovals(dir)
	if err != nil {
		return nil, err
	}
	return networking.Interfaces(approvals)
}

var interfaceName = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,32}$`)

var ErrPeerNotTrusted = errors.New("peer fingerprint is not in the trust store")

type verifyPeerFunc func(context.Context, string, netip.AddrPort, peer.Fingerprint, func() ([]networking.Interface, error)) error

func Handler(device Device, dir string) http.Handler {
	return HandlerWithResources(device, dir, nil, nil, nil, nil, nil)
}

func HandlerWithResources(device Device, dir string, receiver *drop.Receiver, tunnels *bridge.Tunnels, key ed25519.PrivateKey, pairs *pairing.Manager, listenerStatus func() ListenerStatus) http.Handler {
	withKey := func(verify func(context.Context, string, netip.AddrPort, peer.Fingerprint, func() ([]networking.Interface, error), ed25519.PrivateKey) error) verifyPeerFunc {
		return func(ctx context.Context, adapter string, endpoint netip.AddrPort, expected peer.Fingerprint, inventory func() ([]networking.Interface, error)) error {
			if len(key) != ed25519.PrivateKeySize {
				return errors.New("local identity unavailable")
			}
			return verify(ctx, adapter, endpoint, expected, inventory, key)
		}
	}
	return handlerWithReceiverAndVerifier(device, dir, receiver, peer.Verify, withKey(peer.VerifyMutual), withKey(peer.VerifyQUIC), tunnels, key, pairs, listenerStatus)
}

func handlerWithReceiverAndVerifier(device Device, dir string, receiver *drop.Receiver, verify, mutualVerify, quicVerify verifyPeerFunc, tunnels *bridge.Tunnels, key ed25519.PrivateKey, pairs *pairing.Manager, listenerStatus func() ListenerStatus) http.Handler {
	mux := http.NewServeMux()
	registerFiles(mux, device, dir, receiver, key)
	var policyMu sync.Mutex
	registerPermissions(mux, dir, device.ID, &policyMu)
	registerServices(mux, dir, device.ID, &policyMu)
	registerTunnels(mux, device, dir, tunnels, key)
	registerPairing(mux, device, dir, key, pairs)
	registerProfile(mux, dir, device)
	registerClipboard(mux, device, dir, clipboard.NewBuffer(), key)
	registerSync(mux, device, dir, syncengine.NewManager(), key)
	mux.HandleFunc("GET "+networkRoute, func(w http.ResponseWriter, r *http.Request) {
		interfaces, err := approvedInventory(dir)
		if err != nil {
			http.Error(w, "Network interface listing unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, interfaces)
	})
	mux.HandleFunc("GET "+scopeRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) != 2 || len(query["interface"]) != 1 || len(query["address"]) != 1 {
			http.Error(w, "Expected one interface name and one IPv4 address", http.StatusBadRequest)
			return
		}
		name := query.Get("interface")
		address, err := netip.ParseAddr(query.Get("address"))
		if !validInterfaceName(name) || err != nil || !address.Is4() {
			http.Error(w, "Expected a valid interface name and IPv4 address", http.StatusBadRequest)
			return
		}
		interfaces, err := approvedInventory(dir)
		if err != nil {
			http.Error(w, "Network scope unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, networking.CheckScope(interfaces, name, address))
	})
	mux.HandleFunc("POST "+discoveryRoute, func(w http.ResponseWriter, r *http.Request) {
		if !policyMu.TryLock() {
			http.Error(w, "Discovery or a policy change is already in progress", http.StatusTooManyRequests)
			return
		}
		defer policyMu.Unlock()
		interfaces, err := approvedInventory(dir)
		if err != nil {
			http.Error(w, "Discovery scope unavailable", http.StatusServiceUnavailable)
			return
		}
		var localService string
		if listenerStatus != nil {
			localService = listenerStatus().ServiceName
		}
		result, err := discovery.Browse(r.Context(), interfaces)
		if err != nil {
			http.Error(w, "Bonjour discovery unavailable", http.StatusServiceUnavailable)
			return
		}
		if listenerStatus != nil {
			result.Services = excludeLocalServices(result.Services, localService, listenerStatus().ServiceName)
		}
		writeJSON(w, result)
	})
	mux.HandleFunc("POST "+resolveRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		name, adapter, transport := query.Get("name"), query.Get("interface"), "tcp"
		validFields := len(query) == 2
		if value, exists := query["transport"]; exists {
			validFields = len(query) == 3 && len(value) == 1
			transport = query.Get("transport")
		}
		if err != nil || !validFields || len(query["name"]) != 1 || len(query["interface"]) != 1 ||
			!validInterfaceName(adapter) || !discovery.ValidServiceName(name) || !discovery.ValidTransport(transport) {
			http.Error(w, "Expected one interface and one DNS-SD instance name", http.StatusBadRequest)
			return
		}
		if !policyMu.TryLock() {
			http.Error(w, "Discovery or a policy change is already in progress", http.StatusTooManyRequests)
			return
		}
		defer policyMu.Unlock()
		result, err := discovery.Resolve(r.Context(), name, adapter, transport, func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		})
		switch {
		case errors.Is(err, discovery.ErrInactiveInterface):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, discovery.ErrServiceNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
		case err != nil:
			http.Error(w, "Bonjour resolution unavailable", http.StatusServiceUnavailable)
		default:
			writeJSON(w, result)
		}
	})
	verifyRequest := func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		adapter, target, pin := query.Get("interface"), query.Get("endpoint"), query.Get("fingerprint")
		endpoint, fingerprint, inputErr := verificationInput(adapter, target, pin)
		if err != nil || inputErr != nil || len(query) != 3 ||
			len(query["interface"]) != 1 || len(query["endpoint"]) != 1 || len(query["fingerprint"]) != 1 {
			http.Error(w, "Expected one adapter, IPv4 endpoint and Ed25519 fingerprint", http.StatusBadRequest)
			return
		}
		if !policyMu.TryLock() {
			http.Error(w, "A network operation or policy change is in progress", http.StatusTooManyRequests)
			return
		}
		defer policyMu.Unlock()
		if r.URL.Path == trustRoute && fingerprint.String() == device.Fingerprint {
			http.Error(w, "Cannot trust this device as a peer", http.StatusBadRequest)
			return
		}
		if r.URL.Path == verifyTrustedRoute || r.URL.Path == verifyQUICRoute {
			trusted, err := storage.IsTrustedPeer(dir, device.ID, fingerprint.String())
			if err != nil {
				http.Error(w, "Unable to read trusted peers", http.StatusServiceUnavailable)
				return
			}
			if !trusted {
				http.Error(w, ErrPeerNotTrusted.Error(), http.StatusForbidden)
				return
			}
		}
		verifier := verify
		switch r.URL.Path {
		case verifyTrustedRoute:
			verifier = mutualVerify
		case verifyQUICRoute:
			verifier = quicVerify
		}
		ctx := r.Context()
		if r.URL.Path == verifyTrustedRoute {
			if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(6 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
				http.Error(w, "Unable to initialize verification", http.StatusServiceUnavailable)
				return
			}
			bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			ctx = bounded
		}
		err = verifier(ctx, adapter, endpoint, fingerprint, func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		})
		switch {
		case errors.Is(err, peer.ErrPeerScope):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, peer.ErrPeerIdentity):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		case errors.Is(err, peer.ErrQUICUnreachable):
			http.Error(w, err.Error(), http.StatusGatewayTimeout)
		case errors.Is(err, context.DeadlineExceeded):
			http.Error(w, "Peer verification timed out", http.StatusGatewayTimeout)
		case err != nil:
			http.Error(w, "Unable to establish the peer TLS connection", http.StatusBadGateway)
		default:
			if r.URL.Path == trustRoute {
				if r.Context().Err() != nil {
					return
				}
				err := storage.SetPeerTrust(dir, device.ID, fingerprint.String(), true)
				if errors.Is(err, storage.ErrTrustLimit) {
					http.Error(w, err.Error(), http.StatusInsufficientStorage)
					return
				}
				if err != nil {
					http.Error(w, "Unable to save trusted peer", http.StatusServiceUnavailable)
					return
				}
			}
			w.WriteHeader(http.StatusNoContent)
		}
	}
	mux.HandleFunc("POST "+matchTrustedRoute, func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		adapter := query.Get("interface")
		endpoint, endpointErr := netip.ParseAddrPort(query.Get("endpoint"))
		if err != nil || endpointErr != nil || !endpoint.Addr().Is4() || endpoint.Port() == 0 ||
			!validInterfaceName(adapter) || len(query) != 2 || len(query["interface"]) != 1 || len(query["endpoint"]) != 1 {
			http.Error(w, "Expected one adapter and IPv4 endpoint", http.StatusBadRequest)
			return
		}
		if !policyMu.TryLock() {
			http.Error(w, "A network operation or policy change is in progress", http.StatusTooManyRequests)
			return
		}
		defer policyMu.Unlock()
		peers, err := storage.TrustedPeers(dir, device.ID)
		if err != nil {
			http.Error(w, "Unable to read trusted peers", http.StatusServiceUnavailable)
			return
		}
		var pin string
		if len(peers) > 0 {
			pin, _ = peer.MatchTrusted(r.Context(), adapter, endpoint, func() ([]networking.Interface, error) {
				return approvedInventory(dir)
			}, func(pin string) (bool, error) {
				return storage.IsTrustedPeer(dir, device.ID, pin)
			})
		}
		writeJSON(w, pin)
	})
	mux.HandleFunc("POST "+verifyPeerRoute, verifyRequest)
	mux.HandleFunc("POST "+verifyTrustedRoute, verifyRequest)
	mux.HandleFunc("POST "+verifyQUICRoute, verifyRequest)
	mux.HandleFunc("POST "+trustRoute, verifyRequest)
	mux.HandleFunc("GET "+trustRoute, func(w http.ResponseWriter, r *http.Request) {
		records, err := storage.TrustedPeers(dir, device.ID)
		if err != nil {
			http.Error(w, "Unable to read trusted peers", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, records)
	})
	mux.HandleFunc("DELETE "+trustRoute+"/{fingerprint}", func(w http.ResponseWriter, r *http.Request) {
		fingerprint, err := peer.ParseFingerprint(r.PathValue("fingerprint"))
		if err != nil {
			http.Error(w, "Invalid peer fingerprint", http.StatusBadRequest)
			return
		}
		policyMu.Lock()
		defer policyMu.Unlock()
		if pairs != nil {
			pairs.CancelPeer(fingerprint.String())
		}
		if err := storage.SetPeerTrust(dir, device.ID, fingerprint.String(), false); err != nil {
			http.Error(w, "Unable to revoke trusted peer", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mutate := func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !validInterfaceName(name) {
			http.Error(w, "Invalid interface name", http.StatusBadRequest)
			return
		}
		policyMu.Lock()
		defer policyMu.Unlock()
		var adapter string
		if r.Method == http.MethodPut {
			var err error
			adapter, err = networking.ApprovalKey(name)
			if err != nil {
				http.Error(w, "Network interface listing unavailable", http.StatusServiceUnavailable)
				return
			}
			if adapter == "" {
				http.Error(w, "Interface is unavailable or ineligible", http.StatusConflict)
				return
			}
		}
		if err := storage.SetInterfaceApproval(dir, name, adapter); err != nil {
			http.Error(w, "Could not save network approval", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	mux.HandleFunc("PUT "+networkRoute+"/{name}/approval", mutate)
	mux.HandleFunc("DELETE "+networkRoute+"/{name}/approval", mutate)
	return mux
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func GetIdentity(ctx context.Context, dir string) (Device, error) {
	var device Device
	err := requestLocal(ctx, dir, http.MethodGet, IdentityRoute, &device)
	return device, err
}

func GetInterfaces(ctx context.Context, dir string) ([]networking.Interface, error) {
	var interfaces []networking.Interface
	err := requestLocal(ctx, dir, http.MethodGet, networkRoute, &interfaces)
	return interfaces, err
}

func excludeLocalServices(services []discovery.Service, before, after string) []discovery.Service {
	return slices.DeleteFunc(services, func(service discovery.Service) bool {
		return (before != "" && service.Name == before) || (after != "" && service.Name == after)
	})
}

func Discover(ctx context.Context, dir string) (discovery.Result, error) {
	var result discovery.Result
	err := requestLocal(ctx, dir, http.MethodPost, discoveryRoute, &result)
	return result, err
}

func ResolveDiscovery(ctx context.Context, dir, adapter, name string) (discovery.Resolution, error) {
	return ResolveDiscoveryTransport(ctx, dir, adapter, name, "tcp")
}

func ResolveDiscoveryTransport(ctx context.Context, dir, adapter, name, transport string) (discovery.Resolution, error) {
	if !validInterfaceName(adapter) || !discovery.ValidServiceName(name) || !discovery.ValidTransport(transport) {
		return discovery.Resolution{}, errors.New("expected a valid interface, DNS-SD instance name and TCP or UDP")
	}
	query := url.Values{"interface": {adapter}, "name": {name}, "transport": {transport}}
	var result discovery.Resolution
	err := requestLocal(ctx, dir, http.MethodPost, resolveRoute+"?"+query.Encode(), &result)
	return result, err
}

func verificationInput(adapter, target, pin string) (netip.AddrPort, peer.Fingerprint, error) {
	endpoint, err := netip.ParseAddrPort(target)
	if !validInterfaceName(adapter) || err != nil || !endpoint.Addr().Is4() || endpoint.Port() == 0 {
		return netip.AddrPort{}, peer.Fingerprint{}, errors.New("expected a valid adapter and literal IPv4:port")
	}
	fingerprint, err := peer.ParseFingerprint(pin)
	return endpoint, fingerprint, err
}

func MatchTrustedPeer(ctx context.Context, dir, adapter, endpoint string) (string, error) {
	query := url.Values{"interface": {adapter}, "endpoint": {endpoint}}
	var result string
	err := requestLocal(ctx, dir, http.MethodPost, matchTrustedRoute+"?"+query.Encode(), &result)
	return result, err
}

func VerifyPeer(ctx context.Context, dir, adapter, target, pin string) error {
	return peerVerification(ctx, dir, verifyPeerRoute, adapter, target, pin)
}

func TrustPeer(ctx context.Context, dir, adapter, target, pin string) error {
	return peerVerification(ctx, dir, trustRoute, adapter, target, pin)
}

func VerifyTrustedPeer(ctx context.Context, dir, adapter, target, pin string) error {
	return peerVerification(ctx, dir, verifyTrustedRoute, adapter, target, pin)
}

func VerifyQUICPeer(ctx context.Context, dir, adapter, target, pin string) error {
	return peerVerification(ctx, dir, verifyQUICRoute, adapter, target, pin)
}

func TrustedPeers(ctx context.Context, dir string) ([]storage.TrustedPeer, error) {
	var records []storage.TrustedPeer
	err := requestLocal(ctx, dir, http.MethodGet, trustRoute, &records)
	return records, err
}

func RevokePeer(ctx context.Context, dir, pin string) error {
	fingerprint, err := peer.ParseFingerprint(pin)
	if err != nil {
		return err
	}
	return requestLocal(ctx, dir, http.MethodDelete, trustRoute+"/"+fingerprint.String(), nil)
}

func peerVerification(ctx context.Context, dir, route, adapter, target, pin string) error {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return err
	}
	query := url.Values{"interface": {adapter}, "endpoint": {endpoint.String()}, "fingerprint": {fingerprint.String()}}
	if route == verifyTrustedRoute {
		return requestLocalTimed(ctx, dir, http.MethodPost, route+"?"+query.Encode(), nil, 6*time.Second)
	}
	return requestLocal(ctx, dir, http.MethodPost, route+"?"+query.Encode(), nil)
}

func validInterfaceName(name string) bool {
	return interfaceName.MatchString(name) && name != "." && name != ".."
}

func CheckNetworkScope(ctx context.Context, dir, name, input string) (networking.ScopeCheck, error) {
	address, err := netip.ParseAddr(input)
	if !validInterfaceName(name) || err != nil || !address.Is4() {
		return networking.ScopeCheck{}, errors.New("expected a valid interface name and IPv4 address")
	}
	query := url.Values{"interface": {name}, "address": {address.String()}}
	var result networking.ScopeCheck
	err = requestLocal(ctx, dir, http.MethodGet, scopeRoute+"?"+query.Encode(), &result)
	return result, err
}

func SetInterfaceApproval(ctx context.Context, dir, name string, approved bool) error {
	if !validInterfaceName(name) {
		return errors.New("invalid interface name")
	}
	method := http.MethodDelete
	if approved {
		method = http.MethodPut
	}
	return requestLocal(ctx, dir, method, networkRoute+"/"+url.PathEscape(name)+"/approval", nil)
}

func requestLocal(ctx context.Context, dir, method, route string, destination any) error {
	return requestLocalTimedBody(ctx, dir, method, route, nil, destination, 3*time.Second)
}

func requestLocalBody(ctx context.Context, dir, method, route string, body io.Reader, destination any) error {
	return requestLocalTimedBody(ctx, dir, method, route, body, destination, 3*time.Second)
}

func requestLocalTimed(ctx context.Context, dir, method, route string, destination any, timeout time.Duration) error {
	return requestLocalTimedBody(ctx, dir, method, route, nil, destination, timeout)
}

func requestLocalTimedBody(ctx context.Context, dir, method, route string, body io.Reader, destination any, timeout time.Duration) error {
	if err := checkPrivateDir(dir); err != nil {
		return err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(dir, "daemon.sock"))
		if err != nil {
			return nil, err
		}
		if !currentUser(conn.(*net.UnixConn)) {
			conn.Close()
			return nil, errors.New("daemon socket peer has a different OS user")
		}
		return conn, nil
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://lanvory"+route, body)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		var requestErr *url.Error
		if errors.As(err, &requestErr) {
			return requestErr.Err
		}
		return err
	}
	defer response.Body.Close()
	if destination == nil && response.StatusCode == http.StatusNoContent {
		return nil
	}
	if response.StatusCode == http.StatusNotFound && strings.HasPrefix(route, resolveRoute+"?") {
		return discovery.ErrServiceNotFound
	}
	path, _, _ := strings.Cut(route, "?")
	if path == pairingStartRoute {
		switch response.StatusCode {
		case http.StatusConflict:
			return peer.ErrPeerScope
		case http.StatusUnprocessableEntity:
			return peer.ErrPeerIdentity
		case http.StatusTooManyRequests:
			return pairing.ErrLimit
		case http.StatusGone:
			return pairing.ErrDeclined
		case http.StatusGatewayTimeout:
			return errors.New("pairing expired")
		}
	}
	if strings.HasPrefix(path, pairingRoute+"/") {
		switch response.StatusCode {
		case http.StatusNotFound:
			return pairing.ErrUnavailable
		case http.StatusUnprocessableEntity:
			return pairing.ErrCode
		}
	}
	if path == tunnelsRoute || strings.HasPrefix(path, tunnelsRoute+"/") {
		switch response.StatusCode {
		case http.StatusConflict:
			return peer.ErrPeerScope
		case http.StatusForbidden:
			return bridge.ErrNotAvailable
		case http.StatusNotFound:
			return bridge.ErrTunnelNotFound
		case http.StatusTooManyRequests:
			return bridge.ErrTunnelLimit
		}
	}
	if path == sendFileRoute {
		switch response.StatusCode {
		case http.StatusForbidden:
			return ErrPeerNotTrusted
		case http.StatusConflict:
			return peer.ErrPeerScope
		case http.StatusUnprocessableEntity:
			return peer.ErrPeerIdentity
		case http.StatusBadGateway:
			data, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
			text := strings.TrimSpace(string(data))
			if text == drop.ErrNotAccepted.Error() {
				return drop.ErrNotAccepted
			}
			if text != "" {
				return errors.New(text)
			}
			return errors.New("file transfer did not complete")
		}
	}
	if strings.HasPrefix(path, servicesRoute+"/") && method == http.MethodPut {
		switch response.StatusCode {
		case http.StatusConflict:
			return bridge.ErrServiceExists
		case http.StatusInsufficientStorage:
			return bridge.ErrServiceLimit
		}
	}
	if path == permissionGrantRoute {
		switch response.StatusCode {
		case http.StatusNotFound:
			return bridge.ErrNotAvailable
		case http.StatusForbidden:
			return storage.ErrUntrustedPeer
		case http.StatusInsufficientStorage:
			return storage.ErrGrantLimit
		}
	}
	if method == http.MethodPost && (path == verifyPeerRoute || path == verifyTrustedRoute || path == verifyQUICRoute || path == trustRoute) {
		switch response.StatusCode {
		case http.StatusForbidden:
			return ErrPeerNotTrusted
		case http.StatusInsufficientStorage:
			return storage.ErrTrustLimit
		case http.StatusConflict:
			return peer.ErrPeerScope
		case http.StatusUnprocessableEntity:
			return peer.ErrPeerIdentity
		case http.StatusGatewayTimeout:
			return errors.New("peer verification timed out")
		case http.StatusBadGateway:
			return errors.New("unable to establish the peer TLS connection")
		}
	}
	if strings.HasPrefix(path, syncRoute+"/") && strings.HasSuffix(path, "/run") && response.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		if msg := strings.TrimSpace(string(raw)); msg != "" {
			return errors.New(msg)
		}
	}
	if response.StatusCode == http.StatusConflict {
		return errors.New("interface is unavailable or ineligible")
	}
	if response.StatusCode != http.StatusOK || destination == nil {
		return fmt.Errorf("daemon returned %s", response.Status)
	}
	const limit = 64 * 1024
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return err
	}
	if len(data) > limit {
		return errors.New("daemon response exceeds size limit")
	}
	return json.Unmarshal(data, destination)
}

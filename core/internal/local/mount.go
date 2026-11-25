//go:build darwin || linux

package local

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
)

const mountRoute = "/v1/mounts"
const mountExportsRoute = "/v1/mounts/exports"

type mountExportRequest struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	ReadOnly bool   `json:"readOnly"`
}

type mountDiscoverRequest struct {
	Interface   string `json:"interface"`
	Endpoint    string `json:"endpoint"`
	Fingerprint string `json:"fingerprint"`
}

type mountOpenRequest struct {
	Interface   string `json:"interface"`
	Endpoint    string `json:"endpoint"`
	Fingerprint string `json:"fingerprint"`
	PeerName    string `json:"peerName"`
	RemoteID    string `json:"remoteId"`
	MountPoint  string `json:"mountPoint"`
}

type mountNativeRequest struct {
	MountPoint string `json:"mountPoint"`
}

type mountPathRequest struct {
	Path    string `json:"path"`
	NewPath string `json:"newPath,omitempty"`
}

// MountRecord describes an active OS-independent Live Resource Session.
type MountRecord struct {
	ID          string `json:"id"`
	PeerName    string `json:"peerName"`
	Fingerprint string `json:"fingerprint"`
	Interface   string `json:"interface"`
	Endpoint    string `json:"endpoint"`
	RemoteID    string `json:"remoteId"`
	URL         string `json:"url"`
	State       string `json:"state"`
	MountPoint  string `json:"mountPoint,omitempty"`
	Mounted     bool   `json:"mounted"`
	MountError  string `json:"mountError,omitempty"`
	StartedAt   string `json:"startedAt"`
}

// StreamChunkResponse is returned by the Streaming Engine preview/read endpoint.
type StreamChunkResponse struct {
	Offset     int64  `json:"offset"`
	Length     int    `json:"length"`
	TotalSize  int64  `json:"totalSize"`
	ETag       string `json:"etag"`
	FromCache  bool   `json:"fromCache"`
	IsText     bool   `json:"isText"`
	DataBase64 string `json:"dataBase64"`
	Text       string `json:"text,omitempty"`
}

// MountEventsResponse returns monotonic resource events + session state.
type MountEventsResponse struct {
	Seq    uint64                `json:"seq"`
	State  string                `json:"state"`
	Events []mount.ResourceEvent `json:"events"`
}

type activeMount struct {
	record  MountRecord
	session *peer.MountSession
}

type mountManager struct {
	mu     sync.Mutex
	seq    int
	active map[string]*activeMount
}

func newMountManager() *mountManager {
	return &mountManager{active: make(map[string]*activeMount)}
}

func (m *mountManager) list() []MountRecord {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]MountRecord, 0, len(m.active))
	for _, item := range m.active {
		rec := item.record
		if item.session != nil {
			rec.State = item.session.State
		}
		out = append(out, rec)
	}
	return out
}

func (m *mountManager) get(id string) (*activeMount, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.active[id]
	return item, ok
}

func (m *mountManager) add(rec MountRecord, sess *peer.MountSession) MountRecord {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	id := fmt.Sprintf("res-%d", m.seq)
	rec.ID = id
	m.active[id] = &activeMount{record: rec, session: sess}
	return rec
}

func (m *mountManager) setNativeMount(id, mountPoint string, mounted bool, mountErr string) (MountRecord, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.active[id]
	if !ok {
		return MountRecord{}, false
	}
	item.record.MountPoint = mountPoint
	item.record.Mounted = mounted
	item.record.MountError = mountErr
	return item.record, true
}

func (m *mountManager) remove(id string) (*activeMount, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.active[id]
	if ok {
		delete(m.active, id)
	}
	return item, ok
}

// WithMounts mounts Live Resources export, discovery, session, explorer, streaming, and event endpoints.
func WithMounts(next http.Handler, reg *mount.Registry, device Device, dir string, key ed25519.PrivateKey) http.Handler {
	if reg == nil {
		return next
	}
	mux := http.NewServeMux()
	registerMounts(mux, device, dir, reg, key)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == mountRoute || strings.HasPrefix(r.URL.Path, mountRoute+"/") {
			mux.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func registerMounts(mux *http.ServeMux, _ Device, dir string, reg *mount.Registry, key ed25519.PrivateKey) {
	mgr := newMountManager()
	davClient := &http.Client{Timeout: 15 * time.Second}

	mux.HandleFunc("GET "+mountExportsRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, reg.List())
	})

	mux.HandleFunc("POST "+mountExportsRoute, func(w http.ResponseWriter, r *http.Request) {
		var req mountExportRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid resource export request", http.StatusBadRequest)
			return
		}
		exp, err := reg.Add(req.ID, req.Path, req.ReadOnly)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, mount.ErrExists) {
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, exp)
	})

	mux.HandleFunc("DELETE "+mountExportsRoute+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := reg.Remove(id); err != nil {
			http.Error(w, "Exported resource not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Resource Discovery over mTLS peer control channel.
	mux.HandleFunc("POST "+mountRoute+"/discover", func(w http.ResponseWriter, r *http.Request) {
		if len(key) != ed25519.PrivateKeySize {
			http.Error(w, "Local identity unavailable", http.StatusServiceUnavailable)
			return
		}
		var req mountDiscoverRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid resource discovery request", http.StatusBadRequest)
			return
		}
		if !validInterfaceName(req.Interface) {
			http.Error(w, "Invalid network interface", http.StatusBadRequest)
			return
		}
		endpoint, err := netip.ParseAddrPort(strings.TrimSpace(req.Endpoint))
		if err != nil || !endpoint.Addr().Is4() || endpoint.Port() == 0 {
			http.Error(w, "Invalid peer endpoint", http.StatusBadRequest)
			return
		}
		expected, err := peer.ParseFingerprint(strings.TrimSpace(req.Fingerprint))
		if err != nil {
			http.Error(w, "Invalid peer fingerprint", http.StatusBadRequest)
			return
		}
		inventory := func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		}
		list, err := peer.DiscoverResources(r.Context(), req.Interface, endpoint, expected, key, inventory)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, list)
	})

	mux.HandleFunc("GET "+mountRoute, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, mgr.list())
	})

	// Resource Session Manager: opens an OS-independent WebDAV session (no mandatory OS mount).
	mux.HandleFunc("POST "+mountRoute+"/open", func(w http.ResponseWriter, r *http.Request) {
		if len(key) != ed25519.PrivateKeySize {
			http.Error(w, "Local identity unavailable", http.StatusServiceUnavailable)
			return
		}
		var req mountOpenRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "Invalid resource session request", http.StatusBadRequest)
			return
		}
		if !validInterfaceName(req.Interface) {
			http.Error(w, "Invalid network interface", http.StatusBadRequest)
			return
		}
		endpoint, err := netip.ParseAddrPort(strings.TrimSpace(req.Endpoint))
		if err != nil || !endpoint.Addr().Is4() || endpoint.Port() == 0 {
			http.Error(w, "Invalid peer endpoint", http.StatusBadRequest)
			return
		}
		expected, err := peer.ParseFingerprint(strings.TrimSpace(req.Fingerprint))
		if err != nil {
			http.Error(w, "Invalid peer fingerprint", http.StatusBadRequest)
			return
		}
		if !mount.ValidID(req.RemoteID) {
			http.Error(w, "Invalid remote resource ID", http.StatusBadRequest)
			return
		}
		inventory := func() ([]networking.Interface, error) {
			return approvedInventory(dir)
		}
		sess, err := peer.StartMountSession(
			context.Background(),
			req.Interface,
			endpoint,
			expected,
			key,
			req.RemoteID,
			"127.0.0.1:0",
			inventory,
		)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		rec := mgr.add(MountRecord{
			PeerName:    strings.TrimSpace(req.PeerName),
			Fingerprint: expected.String(),
			Interface:   req.Interface,
			Endpoint:    endpoint.String(),
			RemoteID:    req.RemoteID,
			URL:         sess.URL,
			State:       sess.State,
			StartedAt:   time.Now().UTC().Format(time.RFC3339),
		}, sess)

		w.WriteHeader(http.StatusCreated)
		writeJSON(w, rec)
	})

	// Optional Native Adapter (macOS mount_webdav on demand).
	mux.HandleFunc("POST "+mountRoute+"/{id}/native", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		if runtime.GOOS != "darwin" {
			http.Error(w, "Optional native WebDAV mount adapter is only available on macOS", http.StatusNotImplemented)
			return
		}
		var req mountNativeRequest
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req)
		mountPoint := strings.TrimSpace(req.MountPoint)
		if mountPoint == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			label := sanitizeMountDirName(item.record.PeerName + "-" + item.record.RemoteID)
			if label == "" {
				label = item.record.RemoteID
			}
			mountPoint = filepath.Join(home, "LanvoryMounts", label)
		}
		if err := os.MkdirAll(mountPoint, 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := mountWebDAVDarwin(item.session.URL, mountPoint); err != nil {
			updated, _ := mgr.setNativeMount(id, mountPoint, false, err.Error())
			writeJSON(w, updated)
			return
		}
		updated, _ := mgr.setNativeMount(id, mountPoint, true, "")
		writeJSON(w, updated)
	})

	// Resource Explorer: Go WebDAV Client PROPFIND listing.
	mux.HandleFunc("GET "+mountRoute+"/{id}/browse", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		subPath := r.URL.Query().Get("path")
		if subPath == "" {
			subPath = "/"
		}
		entries, err := mount.ListDirectory(r.Context(), davClient, item.session.URL, subPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, entries)
	})

	// Streaming Engine: HTTP Range + Adaptive Read-Ahead + ETag + bounded memory cache.
	mux.HandleFunc("GET "+mountRoute+"/{id}/stream", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		filePath := r.URL.Query().Get("path")
		if strings.TrimSpace(filePath) == "" {
			http.Error(w, "path query parameter is required", http.StatusBadRequest)
			return
		}
		offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
		length, _ := strconv.ParseInt(r.URL.Query().Get("length"), 10, 64)
		etag := r.URL.Query().Get("etag")

		chunk, err := mount.ReadRange(r.Context(), davClient, item.session.Cache, item.session.URL, filePath, offset, length, etag)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		isText := utf8.Valid(chunk.Data) && !bytes.ContainsRune(chunk.Data, 0)
		resp := StreamChunkResponse{
			Offset:     chunk.Offset,
			Length:     len(chunk.Data),
			TotalSize:  chunk.TotalSize,
			ETag:       chunk.ETag,
			FromCache:  chunk.FromCache,
			IsText:     isText,
			DataBase64: base64.StdEncoding.EncodeToString(chunk.Data),
		}
		if isText {
			resp.Text = string(chunk.Data)
		}
		writeJSON(w, resp)
	})

	// Resource Explorer WebDAV mutations (MKCOL / DELETE / MOVE).
	mux.HandleFunc("POST "+mountRoute+"/{id}/mkdir", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		var req mountPathRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.Path == "" {
			http.Error(w, "Invalid directory path", http.StatusBadRequest)
			return
		}
		if err := mount.CreateDir(r.Context(), davClient, item.session.URL, req.Path); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusCreated)
	})

	mux.HandleFunc("DELETE "+mountRoute+"/session/{id}/entry", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		targetPath := r.URL.Query().Get("path")
		if targetPath == "" {
			http.Error(w, "path query parameter is required", http.StatusBadRequest)
			return
		}
		if err := mount.DeletePath(r.Context(), davClient, item.session.URL, targetPath); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST "+mountRoute+"/{id}/rename", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		var req mountPathRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.Path == "" || req.NewPath == "" {
			http.Error(w, "Invalid rename paths", http.StatusBadRequest)
			return
		}
		if err := mount.RenamePath(r.Context(), davClient, item.session.URL, req.Path, req.NewPath); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Resource Event Engine polling + reconciliation.
	mux.HandleFunc("GET "+mountRoute+"/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.get(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		since, _ := strconv.ParseUint(r.URL.Query().Get("since"), 10, 64)
		seq, events, err := item.session.PollEvents(r.Context(), since)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, MountEventsResponse{
			Seq:    seq,
			State:  item.session.State,
			Events: events,
		})
	})

	mux.HandleFunc("POST "+mountRoute+"/{id}/close", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		item, ok := mgr.remove(id)
		if !ok {
			http.Error(w, "Resource session not found", http.StatusNotFound)
			return
		}
		if item.record.Mounted && item.record.MountPoint != "" && runtime.GOOS == "darwin" {
			_ = unmountDarwin(item.record.MountPoint)
		}
		_ = item.session.Close()
		w.WriteHeader(http.StatusNoContent)
	})
}

func sanitizeMountDirName(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range raw {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func mountWebDAVDarwin(rawURL, mountPoint string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/sbin/mount_webdav", "-i", rawURL, mountPoint)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, msg)
	}
	return nil
}

func unmountDarwin(mountPoint string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/sbin/umount", mountPoint)
	return cmd.Run()
}

// ListMountExports returns all local folders exported as Live Resources.
func ListMountExports(ctx context.Context, dir string) ([]mount.Export, error) {
	var exports []mount.Export
	err := requestLocal(ctx, dir, http.MethodGet, mountExportsRoute, &exports)
	return exports, err
}

// AddMountExport exports a local folder as a Live Resource.
func AddMountExport(ctx context.Context, dir, id, path string, readOnly bool) (mount.Export, error) {
	body, err := json.Marshal(mountExportRequest{ID: id, Path: path, ReadOnly: readOnly})
	if err != nil {
		return mount.Export{}, err
	}
	var exp mount.Export
	err = requestLocalBody(ctx, dir, http.MethodPost, mountExportsRoute, bytes.NewReader(body), &exp)
	return exp, err
}

// RemoveMountExport stops exporting a Live Resource.
func RemoveMountExport(ctx context.Context, dir, id string) error {
	return requestLocal(ctx, dir, http.MethodDelete, mountExportsRoute+"/"+id, nil)
}

// DiscoverPeerResources queries a peer for authorized Live Resources.
func DiscoverPeerResources(ctx context.Context, dir, adapter, target, pin string) ([]mount.ResourceDescriptor, error) {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(mountDiscoverRequest{
		Interface:   adapter,
		Endpoint:    endpoint.String(),
		Fingerprint: fingerprint.String(),
	})
	if err != nil {
		return nil, err
	}
	var list []mount.ResourceDescriptor
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, mountRoute+"/discover", bytes.NewReader(body), &list, 10*time.Second)
	return list, err
}

// ListMounts returns all active Live Resource sessions.
func ListMounts(ctx context.Context, dir string) ([]MountRecord, error) {
	var mounts []MountRecord
	err := requestLocal(ctx, dir, http.MethodGet, mountRoute, &mounts)
	return mounts, err
}

// OpenMount opens an OS-independent Live Resource session to a remote peer.
func OpenMount(ctx context.Context, dir, adapter, target, pin, peerName, remoteID, mountPoint string) (MountRecord, error) {
	endpoint, fingerprint, err := verificationInput(adapter, target, pin)
	if err != nil {
		return MountRecord{}, err
	}
	body, err := json.Marshal(mountOpenRequest{
		Interface:   adapter,
		Endpoint:    endpoint.String(),
		Fingerprint: fingerprint.String(),
		PeerName:    peerName,
		RemoteID:    remoteID,
		MountPoint:  mountPoint,
	})
	if err != nil {
		return MountRecord{}, err
	}
	var rec MountRecord
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, mountRoute+"/open", bytes.NewReader(body), &rec, 15*time.Second)
	return rec, err
}

// AttachNativeMount optionally mounts an active Resource Session in Finder on macOS.
func AttachNativeMount(ctx context.Context, dir, id, mountPoint string) (MountRecord, error) {
	body, err := json.Marshal(mountNativeRequest{MountPoint: mountPoint})
	if err != nil {
		return MountRecord{}, err
	}
	var rec MountRecord
	err = requestLocalTimedBody(ctx, dir, http.MethodPost, mountRoute+"/"+id+"/native", bytes.NewReader(body), &rec, 10*time.Second)
	return rec, err
}

// BrowseMount lists remote directory entries via the Go WebDAV Client.
func BrowseMount(ctx context.Context, dir, id, subPath string) ([]mount.Entry, error) {
	var entries []mount.Entry
	q := ""
	if subPath != "" {
		q = "?path=" + strings.ReplaceAll(subPath, " ", "%20")
	}
	err := requestLocal(ctx, dir, http.MethodGet, mountRoute+"/"+id+"/browse"+q, &entries)
	return entries, err
}

// PollMountEvents polls resource change events and reconciliation for an active session.
func PollMountEvents(ctx context.Context, dir, id string, since uint64) (MountEventsResponse, error) {
	var resp MountEventsResponse
	err := requestLocal(ctx, dir, http.MethodGet, fmt.Sprintf("%s/%s/events?since=%d", mountRoute, id, since), &resp)
	return resp, err
}

// CloseMount closes an active Live Resource session (and unmounts native adapter if attached).
func CloseMount(ctx context.Context, dir, id string) error {
	return requestLocal(ctx, dir, http.MethodPost, mountRoute+"/"+id+"/close", nil)
}

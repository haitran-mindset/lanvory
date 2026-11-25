package mount

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

const Protocol = "lanvory-mount/1"

var validIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

var (
	ErrInvalidID   = errors.New("mount ID must match ^[a-z0-9][a-z0-9_-]{0,63}$")
	ErrInvalidPath = errors.New("mount path must be an existing non-symlink directory")
	ErrNotFound    = errors.New("exported mount not found")
	ErrExists      = errors.New("mount ID already exists")
)

type Export struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	ReadOnly bool   `json:"readOnly"`
}

type Registry struct {
	mu      sync.RWMutex
	exports map[string]Export
	events  *EventBus
}

func NewRegistry() *Registry {
	return &Registry{
		exports: make(map[string]Export),
		events:  NewEventBus(256),
	}
}

func (r *Registry) Events() *EventBus {
	return r.events
}

func (r *Registry) DescribeAuthorized(allowed func(id string) bool) []ResourceDescriptor {
	exports := r.List()
	out := make([]ResourceDescriptor, 0, len(exports))
	for _, exp := range exports {
		if allowed != nil && !allowed(exp.ID) {
			continue
		}
		out = append(out, DescribeExport(exp))
	}
	return out
}

func ValidID(id string) bool {
	return validIDPattern.MatchString(id)
}

func (r *Registry) Add(id, dirPath string, readOnly bool) (Export, error) {
	if !ValidID(id) {
		return Export{}, ErrInvalidID
	}
	if !filepath.IsAbs(dirPath) {
		return Export{}, ErrInvalidPath
	}
	info, err := os.Lstat(dirPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Export{}, ErrInvalidPath
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.exports[id]; exists {
		return Export{}, ErrExists
	}
	exp := Export{
		ID:       id,
		Path:     filepath.Clean(dirPath),
		ReadOnly: readOnly,
	}
	r.exports[id] = exp
	r.events.Emit("resource.created", id, "/", "")
	r.events.Reconcile(exp)
	return exp, nil
}

func (r *Registry) Remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.exports[id]; !exists {
		return ErrNotFound
	}
	delete(r.exports, id)
	r.events.Emit("resource.removed", id, "/", "")
	return nil
}

func (r *Registry) Get(id string) (Export, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	exp, ok := r.exports[id]
	return exp, ok
}

func (r *Registry) List() []Export {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Export, 0, len(r.exports))
	for _, exp := range r.exports {
		out = append(out, exp)
	}
	slices.SortFunc(out, func(a, b Export) int {
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

// ServeExport serves an RFC 4918 WebDAV + HTTP Range handler confined to export.Path.
// Symlinks and path traversal outside export.Path are strictly rejected.
func ServeExport(exp Export) http.Handler {
	return &davHandler{exp: exp}
}

type davHandler struct {
	exp Export
}

func (h *davHandler) resolve(urlPath string) (rel string, full string, info os.FileInfo, err error) {
	for _, seg := range strings.Split(urlPath, "/") {
		if seg == ".." {
			return "", "", nil, os.ErrPermission
		}
	}
	cleaned := path.Clean("/" + urlPath)
	if strings.Contains(cleaned, "..") {
		return "", "", nil, os.ErrPermission
	}
	rel = strings.TrimPrefix(cleaned, "/")
	if rel == "" {
		info, err = os.Lstat(h.exp.Path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", "", nil, os.ErrPermission
		}
		return ".", h.exp.Path, info, nil
	}
	parts := strings.Split(rel, "/")
	cur := h.exp.Path
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", "", nil, os.ErrPermission
		}
		cur = filepath.Join(cur, part)
		fi, statErr := os.Lstat(cur)
		if statErr != nil {
			return rel, cur, nil, statErr
		}
		if fi.Mode()&os.ModeSymlink != 0 {
			return "", "", nil, os.ErrPermission
		}
		info = fi
	}
	return rel, cur, info, nil
}

func (h *davHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("DAV", "1")
	w.Header().Set("Accept-Ranges", "bytes")

	switch r.Method {
	case http.MethodOptions:
		allow := "OPTIONS, GET, HEAD, PROPFIND"
		if !h.exp.ReadOnly {
			allow += ", PUT, DELETE, MKCOL, MOVE"
		}
		w.Header().Set("Allow", allow)
		w.WriteHeader(http.StatusOK)

	case "PROPFIND":
		h.handlePropfind(w, r)

	case http.MethodGet, http.MethodHead:
		h.handleGet(w, r)

	case http.MethodPut:
		if h.exp.ReadOnly {
			http.Error(w, "Mount is read-only", http.StatusForbidden)
			return
		}
		h.handlePut(w, r)

	case "MKCOL":
		if h.exp.ReadOnly {
			http.Error(w, "Mount is read-only", http.StatusForbidden)
			return
		}
		h.handleMkcol(w, r)

	case http.MethodDelete:
		if h.exp.ReadOnly {
			http.Error(w, "Mount is read-only", http.StatusForbidden)
			return
		}
		h.handleDelete(w, r)

	case "MOVE":
		if h.exp.ReadOnly {
			http.Error(w, "Mount is read-only", http.StatusForbidden)
			return
		}
		h.handleMove(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *davHandler) handleGet(w http.ResponseWriter, r *http.Request) {
	_, full, info, err := h.resolve(r.URL.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "Forbidden", http.StatusForbidden)
		}
		return
	}
	if info.IsDir() {
		http.Error(w, "Cannot GET a directory", http.StatusMethodNotAllowed)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		http.Error(w, "Unable to open file", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func (h *davHandler) handlePut(w http.ResponseWriter, r *http.Request) {
	rel, full, info, err := h.resolve(r.URL.Path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if rel == "." || (info != nil && info.IsDir()) {
		http.Error(w, "Cannot overwrite a directory", http.StatusConflict)
		return
	}
	parent := filepath.Dir(full)
	if pInfo, pErr := os.Lstat(parent); pErr != nil || !pInfo.IsDir() || pInfo.Mode()&os.ModeSymlink != 0 {
		http.Error(w, "Parent directory missing", http.StatusConflict)
		return
	}
	tmp, err := os.CreateTemp(parent, ".lanvory-put-*")
	if err != nil {
		http.Error(w, "Unable to write file", http.StatusInternalServerError)
		return
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		_ = tmp.Close()
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := io.Copy(tmp, r.Body); err != nil {
		http.Error(w, "Write failed", http.StatusBadRequest)
		return
	}
	if err := tmp.Close(); err != nil {
		http.Error(w, "Flush failed", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpName, full); err != nil {
		http.Error(w, "Commit failed", http.StatusInternalServerError)
		return
	}
	cleanup = false
	if info == nil {
		w.WriteHeader(http.StatusCreated)
	} else {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *davHandler) handleMkcol(w http.ResponseWriter, r *http.Request) {
	rel, full, _, err := h.resolve(r.URL.Path)
	if err == nil {
		http.Error(w, "Already exists", http.StatusMethodNotAllowed)
		return
	}
	if !errors.Is(err, os.ErrNotExist) || rel == "." {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if err := os.Mkdir(full, 0o755); err != nil {
		http.Error(w, "Unable to create directory", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *davHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	rel, full, _, err := h.resolve(r.URL.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "Forbidden", http.StatusForbidden)
		}
		return
	}
	if rel == "." {
		http.Error(w, "Cannot delete mount root", http.StatusForbidden)
		return
	}
	if err := os.RemoveAll(full); err != nil {
		http.Error(w, "Delete failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *davHandler) handleMove(w http.ResponseWriter, r *http.Request) {
	destHeader := r.Header.Get("Destination")
	if destHeader == "" {
		http.Error(w, "Missing Destination header", http.StatusBadRequest)
		return
	}
	parsedDest, err := url.Parse(destHeader)
	if err != nil {
		http.Error(w, "Invalid Destination", http.StatusBadRequest)
		return
	}
	relSrc, fullSrc, _, err := h.resolve(r.URL.Path)
	if err != nil || relSrc == "." {
		http.Error(w, "Source not found", http.StatusNotFound)
		return
	}
	relDst, fullDst, existingDst, dstErr := h.resolve(parsedDest.Path)
	if (dstErr != nil && !errors.Is(dstErr, os.ErrNotExist)) || relDst == "." {
		http.Error(w, "Forbidden destination", http.StatusForbidden)
		return
	}
	if err := os.Rename(fullSrc, fullDst); err != nil {
		http.Error(w, "Move failed", http.StatusInternalServerError)
		return
	}
	if existingDst == nil {
		w.WriteHeader(http.StatusCreated)
	} else {
		w.WriteHeader(http.StatusNoContent)
	}
}

type davMultistatus struct {
	XMLName   xml.Name      `xml:"DAV: multistatus"`
	Responses []davResponse `xml:"response"`
}

type davResponse struct {
	Href     string        `xml:"href"`
	Propstat []davPropstat `xml:"propstat"`
}

type davPropstat struct {
	Prop   davProp `xml:"prop"`
	Status string  `xml:"status"`
}

type davProp struct {
	DisplayName      string            `xml:"displayname,omitempty"`
	GetContentLength *int64            `xml:"getcontentlength,omitempty"`
	GetLastModified  string            `xml:"getlastmodified,omitempty"`
	ResourceType     *davResourceType  `xml:"resourcetype"`
}

type davResourceType struct {
	Collection *struct{} `xml:"collection,omitempty"`
}

func (h *davHandler) handlePropfind(w http.ResponseWriter, r *http.Request) {
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "1"
	}
	_, full, info, err := h.resolve(r.URL.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "Forbidden", http.StatusForbidden)
		}
		return
	}
	baseHref := path.Clean("/" + r.URL.Path)
	if info.IsDir() && !strings.HasSuffix(baseHref, "/") {
		baseHref += "/"
	}

	var responses []davResponse
	responses = append(responses, buildDavResponse(baseHref, info))

	if info.IsDir() && depth != "0" {
		entries, readErr := os.ReadDir(full)
		if readErr == nil {
			for _, entry := range entries {
				if entry.Type()&os.ModeSymlink != 0 || entry.Name() == ".DS_Store" {
					continue
				}
				fi, fiErr := entry.Info()
				if fiErr != nil {
					continue
				}
				childHref := path.Join(baseHref, url.PathEscape(entry.Name()))
				if fi.IsDir() {
					childHref += "/"
				}
				responses = append(responses, buildDavResponse(childHref, fi))
			}
		}
	}

	ms := davMultistatus{Responses: responses}
	var buf bytes.Buffer
	buf.WriteString(xml.Header)
	if err := xml.NewEncoder(&buf).Encode(ms); err != nil {
		http.Error(w, "XML encode failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = w.Write(buf.Bytes())
}

func buildDavResponse(href string, info os.FileInfo) davResponse {
	prop := davProp{
		DisplayName:     info.Name(),
		GetLastModified: info.ModTime().UTC().Format(http.TimeFormat),
		ResourceType:    &davResourceType{},
	}
	if info.IsDir() {
		prop.ResourceType.Collection = &struct{}{}
	} else {
		size := info.Size()
		prop.GetContentLength = &size
	}
	return davResponse{
		Href: href,
		Propstat: []davPropstat{
			{
				Prop:   prop,
				Status: "HTTP/1.1 200 OK",
			},
		},
	}
}

// ServeConn serves a single HTTP/WebDAV session over an mTLS peer connection.
func ServeConn(ctx context.Context, conn io.ReadWriteCloser, handler http.Handler) error {
	defer conn.Close()
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	// Wrap single connection in a one-shot net.Listener is in peer/mount.go.
	_ = ctx
	_ = server
	return fmt.Errorf("use peer.ServeMountConn")
}

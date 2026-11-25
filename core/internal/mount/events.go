package mount

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ResourceDescriptor describes an authorized exported resource for Resource Discovery.
type ResourceDescriptor struct {
	ID         string `json:"id"`
	ReadOnly   bool   `json:"readOnly"`
	FileCount  int    `json:"fileCount"`
	TotalBytes int64  `json:"totalBytes"`
	UpdatedAt  string `json:"updatedAt"`
}

// ResourceEvent represents a resource, file, or permission change event.
type ResourceEvent struct {
	Seq        uint64 `json:"seq"`
	Type       string `json:"type"`
	ResourceID string `json:"resourceId"`
	Path       string `json:"path,omitempty"`
	OldPath    string `json:"oldPath,omitempty"`
	Timestamp  string `json:"timestamp"`
}

type fileSnap struct {
	size    int64
	modUnix int64
	isDir   bool
}

// EventBus stores bounded monotonic resource change events and supports
// directory snapshot reconciliation when a peer reconnects or misses events.
type EventBus struct {
	mu        sync.Mutex
	seq       uint64
	maxEvents int
	events    []ResourceEvent
	snapshots map[string]map[string]fileSnap
}

// NewEventBus creates a bounded in-memory Resource Event Engine.
func NewEventBus(maxEvents int) *EventBus {
	if maxEvents <= 0 {
		maxEvents = 256
	}
	return &EventBus{
		maxEvents: maxEvents,
		snapshots: make(map[string]map[string]fileSnap),
	}
}

// Emit appends a new event with a monotonic sequence number.
func (b *EventBus) Emit(eventType, resourceID, path, oldPath string) ResourceEvent {
	if b == nil {
		return ResourceEvent{}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.seq++
	ev := ResourceEvent{
		Seq:        b.seq,
		Type:       eventType,
		ResourceID: resourceID,
		Path:       path,
		OldPath:    oldPath,
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
	}
	b.events = append(b.events, ev)
	if len(b.events) > b.maxEvents {
		b.events = append([]ResourceEvent(nil), b.events[len(b.events)-b.maxEvents:]...)
	}
	return ev
}

// Since returns events with Seq > sinceSeq for the given resourceID (or all if empty).
func (b *EventBus) Since(resourceID string, sinceSeq uint64) (uint64, []ResourceEvent) {
	if b == nil {
		return 0, nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []ResourceEvent
	for _, ev := range b.events {
		if ev.Seq <= sinceSeq {
			continue
		}
		if resourceID != "" && ev.ResourceID != resourceID {
			continue
		}
		out = append(out, ev)
	}
	return b.seq, out
}

// Reconcile walks an exported directory (bounded to 4096 entries, skipping symlinks)
// and emits file.created, file.modified, or file.deleted events for any drift.
func (b *EventBus) Reconcile(exp Export) []ResourceEvent {
	if b == nil {
		return nil
	}
	current := make(map[string]fileSnap)
	count := 0
	_ = filepath.WalkDir(exp.Path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(exp.Path, p)
		if err != nil || rel == "." {
			return nil
		}
		count++
		if count > 4096 {
			return filepath.SkipAll
		}
		info, statErr := d.Info()
		if statErr != nil {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		current[relSlash] = fileSnap{
			size:    info.Size(),
			modUnix: info.ModTime().UnixNano(),
			isDir:   info.IsDir(),
		}
		return nil
	})

	b.mu.Lock()
	prev, hadPrev := b.snapshots[exp.ID]
	b.snapshots[exp.ID] = current
	b.mu.Unlock()

	if !hadPrev {
		return nil
	}

	var emitted []ResourceEvent
	for rel, snap := range current {
		old, ok := prev[rel]
		if !ok {
			emitted = append(emitted, b.Emit("file.created", exp.ID, "/"+rel, ""))
		} else if !snap.isDir && (old.size != snap.size || old.modUnix != snap.modUnix) {
			emitted = append(emitted, b.Emit("file.modified", exp.ID, "/"+rel, ""))
		}
	}
	for rel := range prev {
		if _, ok := current[rel]; !ok {
			emitted = append(emitted, b.Emit("file.deleted", exp.ID, "/"+rel, ""))
		}
	}
	return emitted
}

// DescribeExport summarizes an export's top-level/walked file count and total bytes.
func DescribeExport(exp Export) ResourceDescriptor {
	var fileCount int
	var totalBytes int64
	_ = filepath.WalkDir(exp.Path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if fileCount > 4096 {
				return filepath.SkipAll
			}
			return nil
		}
		info, statErr := d.Info()
		if statErr == nil {
			fileCount++
			totalBytes += info.Size()
		}
		return nil
	})
	return ResourceDescriptor{
		ID:         exp.ID,
		ReadOnly:   exp.ReadOnly,
		FileCount:  fileCount,
		TotalBytes: totalBytes,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
}

func normalizeEventPath(p string) string {
	p = strings.TrimSpace(p)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

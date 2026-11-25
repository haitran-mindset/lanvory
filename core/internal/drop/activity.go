package drop

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"sort"
	"sync"
	"time"
)

const Waiting = "waiting"
const Streaming = "streaming"
const Completed = "completed"
const Failed = "failed"
const Declined = "declined"
const Cancelled = "cancelled"
const HistoryLimit = 100

type Transfer struct {
	ID                 string    `json:"id"`
	Direction          string    `json:"direction"`
	Fingerprint        string    `json:"fingerprint"`
	Name               string    `json:"name"`
	Size               int64     `json:"size"`
	Bytes              int64     `json:"bytes"`
	State              string    `json:"state"`
	UpdatedAt          time.Time `json:"updatedAt"`
	StreamingElapsedMS int64     `json:"streamingElapsedMs,omitempty"`
	streamStartedAt    time.Time
}

type Activity struct {
	Transfers          []Transfer `json:"transfers"`
	HistoryUnavailable bool       `json:"historyUnavailable"`
}

type Tracker struct {
	mu          sync.Mutex
	store       HistoryStore
	active      map[string]Transfer
	history     []Transfer
	unavailable bool
}

type HistoryStore interface {
	Load() ([]Transfer, error)
	Record(Transfer) error
	Delete(string) error
}

var ErrActiveTransfer = errors.New("cannot remove an active transfer")

func (t *Tracker) DeleteHistory(id string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, active := t.active[id]; active {
		return ErrActiveTransfer
	}
	if t.store != nil {
		if err := t.store.Delete(id); err != nil {
			return err
		}
	}
	t.history = slices.DeleteFunc(t.history, func(item Transfer) bool { return item.ID == id })
	return nil
}

func NewTracker(store HistoryStore) *Tracker {
	tracker := &Tracker{store: store, active: make(map[string]Transfer)}
	if store != nil {
		history, err := store.Load()
		if err != nil {
			tracker.unavailable = true
		} else {
			tracker.history = history[:min(len(history), HistoryLimit)]
		}
	}
	return tracker
}

func (t *Tracker) Snapshot() Activity {
	t.mu.Lock()
	defer t.mu.Unlock()
	records := make([]Transfer, 0, len(t.active)+len(t.history))
	for _, item := range t.active {
		if !item.streamStartedAt.IsZero() {
			item.StreamingElapsedMS = time.Since(item.streamStartedAt).Milliseconds()
		}
		records = append(records, item)
	}
	records = append(records, t.history...)
	sort.Slice(records, func(i, j int) bool { return records[i].UpdatedAt.After(records[j].UpdatedAt) })
	return Activity{Transfers: records, HistoryUnavailable: t.unavailable}
}

func (t *Tracker) Start(id, direction, fingerprint string, file Manifest) *Progress {
	if id == "" {
		var nonce [16]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			return &Progress{}
		}
		id = hex.EncodeToString(nonce[:])
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.active[id] = Transfer{ID: id, Direction: direction, Fingerprint: fingerprint, Name: file.Name, Size: file.Size, State: Waiting, UpdatedAt: time.Now().UTC()}
	return &Progress{tracker: t, id: id}
}

type Progress struct {
	tracker *Tracker
	id      string
}

func (p *Progress) Update(bytes int64) {
	if p == nil || p.tracker == nil {
		return
	}
	t := p.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	record, ok := t.active[p.id]
	if !ok {
		return
	}
	now := time.Now()
	if record.State != Streaming || bytes < record.Bytes {
		record.streamStartedAt = now
	}
	record.Bytes = bytes
	record.State = Streaming
	record.UpdatedAt = now.UTC()
	t.active[p.id] = record
}

func (p *Progress) Finish(err error) {
	if p == nil || p.tracker == nil {
		return
	}
	t := p.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	record, ok := t.active[p.id]
	if !ok {
		return
	}
	delete(t.active, p.id)
	switch {
	case err == nil:
		record.State = Completed
		record.Bytes = record.Size
	case errors.Is(err, ErrDeclined):
		record.State = Declined
	case errors.Is(err, context.Canceled):
		record.State = Cancelled
	default:
		record.State = Failed
	}
	record.UpdatedAt = time.Now().UTC()
	record.streamStartedAt = time.Time{}
	t.history = append([]Transfer{record}, t.history...)
	t.history = t.history[:min(len(t.history), HistoryLimit)]
	if t.store != nil && t.store.Record(record) != nil {
		t.unavailable = true
	}
}

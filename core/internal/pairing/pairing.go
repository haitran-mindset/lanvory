package pairing

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
)

const Protocol = "lanvory-pair/1"
const ExporterLabel = "EXPORTER-Lanvory-Pairing-v1"
const Window = 60 * time.Second
const approval byte = 1
const receipt byte = 2

var ErrUnavailable = errors.New("pairing request is no longer available")
var ErrCode = errors.New("pairing code does not match")
var ErrDeclined = errors.New("pairing was cancelled or declined")
var ErrLimit = errors.New("pairing is already pending or rate limited")

type Request struct {
	ID          string    `json:"id"`
	Direction   string    `json:"direction"`
	Fingerprint string    `json:"fingerprint"`
	Code        string    `json:"code"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type attempt struct {
	request Request
	answer  chan bool
	cancel  context.CancelFunc
	decided bool
	wrong   int
}

type Manager struct {
	mu      sync.Mutex
	pending map[string]*attempt
	recent  map[string]time.Time
	save    func(string) error
}

func New(save func(string) error) *Manager {
	return &Manager{pending: make(map[string]*attempt), recent: make(map[string]time.Time), save: save}
}

func (m *Manager) List() []Request {
	m.mu.Lock()
	defer m.mu.Unlock()
	records := []Request{}
	now := time.Now()
	for _, item := range m.pending {
		if !item.decided && now.Before(item.request.ExpiresAt) {
			records = append(records, item.request)
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].ExpiresAt.Before(records[j].ExpiresAt) })
	return records
}

func (m *Manager) Decide(id, code string, approve bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.pending[id]
	if item == nil || item.decided || !time.Now().Before(item.request.ExpiresAt) {
		return ErrUnavailable
	}
	if approve {
		expected := strings.ReplaceAll(item.request.Code, "-", "")
		actual := strings.ToLower(strings.ReplaceAll(code, "-", ""))
		if subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) != 1 {
			item.wrong++
			if item.wrong >= 3 {
				item.decided = true
				item.cancel()
			}
			return ErrCode
		}
	}
	item.decided = true
	item.answer <- approve
	return nil
}

func (m *Manager) CancelPeer(fingerprint string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, item := range m.pending {
		if item.request.Fingerprint == fingerprint {
			item.cancel()
		}
	}
}

func (m *Manager) add(direction, fingerprint, source string, code [16]byte, cancel context.CancelFunc, until time.Time) (*attempt, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	text := hex.EncodeToString(code[:])
	grouped := text[:8] + "-" + text[8:16] + "-" + text[16:24] + "-" + text[24:]
	request := Request{ID: hex.EncodeToString(nonce[:]), Direction: direction, Fingerprint: fingerprint, Code: grouped, ExpiresAt: until.UTC()}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.pending) >= 8 {
		return nil, ErrLimit
	}
	for _, item := range m.pending {
		if item.request.Fingerprint == fingerprint {
			return nil, ErrLimit
		}
	}
	if direction == "incoming" {
		now := time.Now()
		for addr, expiry := range m.recent {
			if !now.Before(expiry) {
				delete(m.recent, addr)
			}
		}
		if len(m.recent) >= 256 || now.Before(m.recent[source]) {
			return nil, ErrLimit
		}
		m.recent[source] = now.Add(10 * time.Second)
	}
	item := &attempt{request: request, answer: make(chan bool, 1), cancel: cancel}
	m.pending[request.ID] = item
	return item, nil
}

// Exchange receives a code derived locally from the authenticated TLS exporter.
// Only consent markers travel over the peer connection.
func (m *Manager) Exchange(ctx context.Context, conn net.Conn, direction, fingerprint, source string, code [16]byte, scope func() bool) error {
	ctx, cancel := context.WithTimeout(ctx, Window)
	defer cancel()
	until, _ := ctx.Deadline()
	if !scope() {
		return ErrUnavailable
	}
	if err := conn.SetDeadline(until); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { abort(conn) })
	defer stop()
	item, err := m.add(direction, fingerprint, source, code, cancel, until)
	if err != nil {
		return err
	}
	defer func() {
		m.mu.Lock()
		delete(m.pending, item.request.ID)
		m.mu.Unlock()
	}()

	peerConsent, remoteReceipt := readPairMarkers(conn)
	if err := waitForLocal(ctx, item, peerConsent, remoteReceipt, scope); err != nil {
		abort(conn)
		return err
	}
	if _, err := conn.Write([]byte{approval}); err != nil {
		return err
	}
	if err := awaitPeer(ctx, peerConsent, scope); err != nil {
		return err
	}

	m.mu.Lock()
	if ctx.Err() != nil || !scope() {
		m.mu.Unlock()
		return ErrUnavailable
	}
	err = m.save(fingerprint)
	m.mu.Unlock()
	if err != nil {
		return err
	}

	if _, err := conn.Write([]byte{receipt}); err != nil {
		return err
	}
	return awaitPeer(ctx, remoteReceipt, scope)
}

// When the peer approves first, continue monitoring the same reader for a
// disconnect. A receipt cannot be valid until we have sent local approval.
func waitForLocal(ctx context.Context, item *attempt, peer chan error, receipt <-chan error, scope func() bool) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	remote := peer
	var disconnect <-chan error
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !scope() {
				return ErrUnavailable
			}
		case err := <-remote:
			if err != nil {
				return err
			}
			remote = nil
			disconnect = receipt
			peer <- nil
		case <-disconnect:
			return ErrDeclined
		case approved := <-item.answer:
			if !approved {
				return ErrDeclined
			}
			if !scope() {
				return ErrUnavailable
			}
			return nil
		}
	}
}

func awaitPeer(ctx context.Context, result <-chan error, scope func() bool) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !scope() {
				return ErrUnavailable
			}
		case err := <-result:
			return err
		}
	}
}

func readPairMarkers(conn net.Conn) (chan error, <-chan error) {
	consent := make(chan error, 1)
	saved := make(chan error, 1)
	go func() {
		err := readMarker(conn, approval)
		consent <- err
		if err == nil {
			saved <- readMarker(conn, receipt)
		}
	}()
	return consent, saved
}

func readMarker(conn net.Conn, expected byte) error {
	var marker [1]byte
	if _, err := io.ReadFull(conn, marker[:]); err != nil || marker[0] != expected {
		return ErrDeclined
	}
	return nil
}

func abort(conn net.Conn) {
	if secured, ok := conn.(interface{ NetConn() net.Conn }); ok {
		conn = secured.NetConn()
	}
	conn.Close()
}

package drop

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const Inbox = "inbox"
const MaxFileSize = 1 << 30
const approvalWindow = 45 * time.Second
const maxOffers = 16
const maxOffersPerPeer = 2

var ErrPermission = errors.New("inbox permission denied")
var ErrDeclined = errors.New("file offer declined")
var ErrOffersFull = errors.New("incoming offer limit reached")
var ErrOfferUnavailable = errors.New("incoming offer is no longer awaiting approval")
var ErrIntegrity = errors.New("file SHA-256 mismatch")

type Manifest struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Offer struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
	Manifest
	ExpiresAt time.Time `json:"expiresAt"`
}

type pendingOffer struct {
	Offer
	decision chan bool
}

type Receiver struct {
	tracker  *Tracker
	stateDir string
	allowed  func(string) (bool, error)
	mu       sync.Mutex
	pending  map[string]*pendingOffer
	active   int
	perPeer  map[string]int
}

func NewReceiver(stateDir string, allowed func(string) (bool, error), history HistoryStore) *Receiver {
	return &Receiver{
		stateDir: stateDir, allowed: allowed, tracker: NewTracker(history),
		pending: make(map[string]*pendingOffer), perPeer: make(map[string]int),
	}
}

func (r *Receiver) Tracker() *Tracker { return r.tracker }

func ValidateManifest(manifest Manifest) error {
	if manifest.Size < 0 || manifest.Size > MaxFileSize {
		return errors.New("unsupported file size")
	}
	if len(manifest.SHA256) != sha256.Size*2 {
		return errors.New("invalid file SHA-256")
	}
	if _, err := hex.DecodeString(manifest.SHA256); err != nil {
		return errors.New("invalid file SHA-256")
	}
	name := manifest.Name
	if len(name) == 0 || len(name) > 240 || !utf8.ValidString(name) ||
		strings.HasPrefix(name, ".") || strings.TrimSpace(name) != name || strings.HasSuffix(name, ".") ||
		strings.ContainsAny(name, `/\<>:"|?*`) ||
		strings.ContainsFunc(name, func(r rune) bool {
			return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Zl, r) || unicode.Is(unicode.Zp, r)
		}) {
		return errors.New("invalid file name")
	}
	base, _, _ := strings.Cut(strings.ToUpper(name), ".")
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return errors.New("reserved file name")
	}
	if strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT") {
		switch base[3:] {
		case "1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³":
			return errors.New("reserved file name")
		}
	}
	return nil
}

// Pending snapshots the offers awaiting a local decision.
func (r *Receiver) Pending() []Offer {
	r.mu.Lock()
	defer r.mu.Unlock()
	offers := make([]Offer, 0, len(r.pending))
	for _, offer := range r.pending {
		if time.Now().Before(offer.ExpiresAt) {
			offers = append(offers, offer.Offer)
		}
	}
	return offers
}

// Decide consumes an offer ID once.
func (r *Receiver) Decide(id string, allow bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	offer, exists := r.pending[id]
	if !exists || !time.Now().Before(offer.ExpiresAt) {
		return ErrOfferUnavailable
	}
	delete(r.pending, id)
	offer.decision <- allow
	return nil
}

// Receive calls begin only after local approval and a fresh policy check.
// The caller owns the reader and must enforce transport deadlines.
func (r *Receiver) Receive(ctx context.Context, fingerprint string, manifest Manifest, begin func() (io.Reader, error)) error {
	return r.receive(ctx, fingerprint, manifest, begin, nil)
}

func (r *Receiver) receive(ctx context.Context, fingerprint string, manifest Manifest, begin func() (io.Reader, error), scope func() bool) (result error) {
	if err := ValidateManifest(manifest); err != nil {
		return err
	}
	if err := r.check(ctx, fingerprint, scope); err != nil {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	id := hex.EncodeToString(nonce[:])
	offer := &pendingOffer{
		Offer:    Offer{ID: id, Fingerprint: fingerprint, Manifest: manifest, ExpiresAt: time.Now().Add(approvalWindow).UTC()},
		decision: make(chan bool, 1),
	}

	r.mu.Lock()
	if r.active >= maxOffers || r.perPeer[fingerprint] >= maxOffersPerPeer || r.pending[id] != nil {
		r.mu.Unlock()
		return ErrOffersFull
	}
	r.pending[id] = offer
	r.active++
	r.perPeer[fingerprint]++
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.pending, id)
		r.active--
		r.perPeer[fingerprint]--
		if r.perPeer[fingerprint] == 0 {
			delete(r.perPeer, fingerprint)
		}
	}()
	progress := r.tracker.Start(id, "incoming", fingerprint, manifest)
	defer func() { progress.Finish(result) }()
	if err := r.awaitDecision(ctx, offer, scope); err != nil {
		return err
	}
	if err := r.check(ctx, fingerprint, scope); err != nil {
		return err
	}
	return r.receiveFile(ctx, offer, begin, scope, progress)
}

func (r *Receiver) awaitDecision(ctx context.Context, offer *pendingOffer, scope func() bool) error {
	expiry := time.NewTimer(time.Until(offer.ExpiresAt))
	defer expiry.Stop()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-expiry.C:
			return ErrOfferUnavailable
		case <-tick.C:
			if err := r.check(ctx, offer.Fingerprint, scope); err != nil {
				return err
			}
		case allowed := <-offer.decision:
			if !allowed {
				return ErrDeclined
			}
			return nil
		}
	}
}

func (r *Receiver) check(ctx context.Context, fingerprint string, scope func() bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if scope != nil && !scope() {
		return ErrPermission
	}
	allowed, err := r.allowed(fingerprint)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrPermission
	}
	return nil
}

func (r *Receiver) receiveFile(ctx context.Context, offer *pendingOffer, begin func() (io.Reader, error), scope func() bool, progress *Progress) error {
	root, err := os.OpenRoot(r.stateDir)
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.Mkdir(Inbox, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := root.Lstat(Inbox)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("invalid local inbox directory")
	}
	inbox, err := root.OpenRoot(Inbox)
	if err != nil {
		return err
	}
	defer inbox.Close()
	if _, err := inbox.Lstat(offer.Name); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return err
		}
		return os.ErrExist
	}
	temporary := ".lanvory-" + offer.ID
	file, err := inbox.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer inbox.Remove(temporary)
	defer file.Close()
	if err := checkSpace(file, offer.Size); err != nil {
		return err
	}
	if err := r.check(ctx, offer.Fingerprint, scope); err != nil {
		return err
	}
	reader, err := begin()
	if err != nil {
		return err
	}
	progress.Update(0)
	digest := sha256.New()
	sink := io.MultiWriter(file, digest)
	data := make([]byte, 64*1024)
	nextCheck := time.Now().Add(250 * time.Millisecond)
	for remaining := offer.Size; remaining > 0; {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !time.Now().Before(nextCheck) {
			if err := r.check(ctx, offer.Fingerprint, scope); err != nil {
				return err
			}
			nextCheck = time.Now().Add(250 * time.Millisecond)
		}
		length := min(int64(len(data)), remaining)
		if _, err := io.ReadFull(reader, data[:length]); err != nil {
			return fmt.Errorf("read file payload: %w", err)
		}
		if _, err := sink.Write(data[:length]); err != nil {
			return err
		}
		remaining -= length
		progress.Update(offer.Size - remaining)
	}
	if !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)), offer.SHA256) {
		return ErrIntegrity
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := r.check(ctx, offer.Fingerprint, scope); err != nil {
		return err
	}
	// A hard link publishes the complete file atomically without overwriting a
	// destination created after the initial check, including a symbolic link.
	return inbox.Link(temporary, offer.Name)
}

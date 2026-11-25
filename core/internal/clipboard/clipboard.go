package clipboard

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	Protocol = "lanvory-clipboard/1"
	MaxBytes = 64 * 1024
)

var (
	ErrDisabled = errors.New("shared clipboard is disabled")
	ErrPaused   = errors.New("shared clipboard is paused")
	ErrTooLarge = errors.New("clipboard content exceeds 64 KiB limit")
	ErrInvalid  = errors.New("clipboard content must be non-empty valid UTF-8")
)

type Entry struct {
	Text              string    `json:"text"`
	SHA256            string    `json:"sha256"`
	OriginFingerprint string    `json:"originFingerprint"`
	ReceivedAt        time.Time `json:"receivedAt"`
}

type State struct {
	Enabled bool   `json:"enabled"`
	Paused  bool   `json:"paused"`
	Latest  *Entry `json:"latest,omitempty"`
}

// Buffer stores the latest incoming clipboard snippet in memory only (disabled by default).
type Buffer struct {
	mu       sync.RWMutex
	enabled  bool
	paused   bool
	lastHash string
	latest   *Entry
}

func NewBuffer() *Buffer {
	return &Buffer{}
}

func HashText(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func ValidateText(text string) error {
	if len(text) == 0 || !utf8.ValidString(text) {
		return ErrInvalid
	}
	if len(text) > MaxBytes {
		return ErrTooLarge
	}
	return nil
}

func (b *Buffer) SetPolicy(enabled, paused bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.enabled = enabled
	b.paused = paused
	if !enabled {
		b.latest = nil
		b.lastHash = ""
	}
}

func (b *Buffer) State() State {
	b.mu.RLock()
	defer b.mu.RUnlock()
	var latestCopy *Entry
	if b.latest != nil {
		cp := *b.latest
		latestCopy = &cp
	}
	return State{
		Enabled: b.enabled,
		Paused:  b.paused,
		Latest:  latestCopy,
	}
}

func (b *Buffer) MarkLocalSent(text string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lastHash = HashText(text)
}

// Receive stores an incoming text snippet unless disabled, paused, oversized, or a duplicate/loop.
func (b *Buffer) Receive(originFingerprint, text string) (bool, error) {
	if err := ValidateText(text); err != nil {
		return false, err
	}
	hash := HashText(text)

	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.enabled {
		return false, ErrDisabled
	}
	if b.paused {
		return false, ErrPaused
	}
	if hash == b.lastHash {
		return false, nil
	}
	b.lastHash = hash
	b.latest = &Entry{
		Text:              text,
		SHA256:            hash,
		OriginFingerprint: originFingerprint,
		ReceivedAt:        time.Now().UTC(),
	}
	return true, nil
}

func (b *Buffer) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.latest = nil
	b.lastHash = ""
}

func WritePacket(w io.Writer, text string) error {
	if err := ValidateText(text); err != nil {
		return err
	}
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(text)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return err
	}
	_, err := io.WriteString(w, text)
	return err
}

func ReadPacket(r io.Reader) (string, error) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return "", err
	}
	size := binary.BigEndian.Uint32(lenBuf[:])
	if size == 0 || size > MaxBytes {
		return "", ErrTooLarge
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	text := string(buf)
	if err := ValidateText(text); err != nil {
		return "", err
	}
	return text, nil
}

func WriteAck(w io.Writer, accepted bool) error {
	var b [1]byte
	if accepted {
		b[0] = 1
	}
	_, err := w.Write(b[:])
	return err
}

func ReadAck(r io.Reader) (bool, error) {
	var b [1]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return false, err
	}
	return b[0] == 1, nil
}

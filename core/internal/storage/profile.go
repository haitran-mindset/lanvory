package storage

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type Profile struct {
	Name      string
	CreatedAt time.Time
}

var ErrInvalidProfileName = errors.New("device name must contain 1 to 63 UTF-8 bytes without control or format characters")

func NormalizeProfileName(name string) (string, error) {
	if !utf8.ValidString(name) || strings.ContainsFunc(name, func(r rune) bool {
		return unicode.IsControl(r) || unicode.Is(unicode.Cf, r)
	}) {
		return "", ErrInvalidProfileName
	}
	name = strings.TrimSpace(name)
	if len(name) == 0 || len(name) > 63 {
		return "", ErrInvalidProfileName
	}
	return name, nil
}

var ErrTrustLimit = errors.New("trusted peer limit reached")

type TrustedPeer struct {
	Fingerprint string    `json:"fingerprint"`
	VerifiedAt  time.Time `json:"verifiedAt"`
}

//go:build !darwin && !linux

package identity

import (
	"crypto/ed25519"
	"errors"
)

func Load(string) (ed25519.PrivateKey, error) {
	return nil, errors.New("this build does not support local file identity storage")
}

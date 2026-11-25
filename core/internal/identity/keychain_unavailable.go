//go:build (!darwin && !linux) || !cgo

package identity

import (
	"crypto/ed25519"
	"errors"
)

func Load(string) (ed25519.PrivateKey, error) {
	return nil, errors.New("this build has no supported OS credential store")
}

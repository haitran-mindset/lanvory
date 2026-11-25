//go:build !darwin || !cgo

package discovery

import (
	"errors"
	"net/netip"
)

func resolveInterface(int, string, string) (uint16, []netip.Addr, error) {
	return 0, nil, errors.New("Bonjour resolution is unavailable on this platform")
}

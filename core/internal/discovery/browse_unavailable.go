//go:build !darwin || !cgo

package discovery

import "errors"

func browseInterface(int) ([]instance, bool, error) {
	return nil, false, errors.New("Bonjour browsing is unavailable on this platform")
}

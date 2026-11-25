//go:build !darwin && !linux

package peer

import (
	"errors"
	"syscall"
)

func bindInterface(int) func(string, string, syscall.RawConn) error {
	return func(string, string, syscall.RawConn) error {
		return errors.New("interface-bound peer listener is unavailable on this platform")
	}
}

//go:build darwin

package peer

import (
	"syscall"
)

func bindInterface(index int) func(string, string, syscall.RawConn) error {
	return func(_, _ string, socket syscall.RawConn) error {
		var setErr error
		if err := socket.Control(func(fd uintptr) {
			setErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_BOUND_IF, index)
		}); err != nil {
			return err
		}
		return setErr
	}
}

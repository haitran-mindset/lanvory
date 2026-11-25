//go:build linux

package peer

import (
	"syscall"

	"golang.org/x/sys/unix"
)

func bindInterface(index int) func(string, string, syscall.RawConn) error {
	return func(_, _ string, socket syscall.RawConn) error {
		if index <= 0 {
			return unix.EINVAL
		}
		var bindErr error
		if err := socket.Control(func(fd uintptr) {
			bindErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_BINDTOIFINDEX, index)
		}); err != nil {
			return err
		}
		return bindErr
	}
}

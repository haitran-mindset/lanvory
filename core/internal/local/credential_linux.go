//go:build linux

package local

import "syscall"

func matchesPeerUID(fd uintptr, uid uint32) bool {
	credentials, err := syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	return err == nil && credentials.Uid == uid
}

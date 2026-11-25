//go:build darwin || linux

package drop

import (
	"errors"
	"os"
	"syscall"
)

func checkSpace(file *os.File, size int64) error {
	var stat syscall.Statfs_t
	if err := syscall.Fstatfs(int(file.Fd()), &stat); err != nil {
		return err
	}
	if stat.Bsize <= 0 {
		return errors.New("invalid filesystem block size")
	}
	blockSize := int64(stat.Bsize)
	required := (size + blockSize - 1) / blockSize
	if stat.Bavail < 0 || uint64(stat.Bavail) < uint64(required) {
		return errors.New("insufficient disk space for receiving file")
	}
	return nil
}

//go:build !darwin && !linux

package drop

import (
	"errors"
	"os"
)

func checkSpace(*os.File, int64) error {
	return errors.New("receiving files is unavailable on this platform")
}

//go:build !darwin || !cgo

package discovery

import (
	"context"
	"errors"
)

const CanPublish = false

func Publish(context.Context, int, string, uint16, string, func()) error {
	return errors.New("Bonjour publication is unavailable on this platform")
}

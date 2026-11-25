//go:build (!darwin && !linux) || !cgo

package storage

import (
	"lanvory.local/core/internal/bridge"
	"time"
)

func SharedServices(string, string) ([]bridge.Service, error) { return nil, errPermissionStorage }
func RegisterService(string, string, bridge.Service) error    { return errPermissionStorage }
func RemoveService(string, string, string) error              { return errPermissionStorage }
func AuthorizedService(string, string, string, string, time.Time) (bridge.Service, error) {
	return bridge.Service{}, errPermissionStorage
}

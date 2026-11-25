//go:build (!darwin && !linux) || !cgo

package storage

import (
	"errors"
	"time"
)

var errPermissionStorage = errors.New("this build has no supported SQLite integration")

func SetGrant(string, string, Grant, bool) error                 { return errPermissionStorage }
func HasGrant(string, string, Grant, time.Time) (bool, error)    { return false, errPermissionStorage }
func Grants(string, string) ([]Grant, error)                     { return nil, errPermissionStorage }
func PermissionEvents(string, string) ([]PermissionEvent, error) { return nil, errPermissionStorage }

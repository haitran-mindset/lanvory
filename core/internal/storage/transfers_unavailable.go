//go:build (!darwin && !linux) || !cgo

package storage

import "lanvory.local/core/internal/drop"

func (TransferHistory) Load() ([]drop.Transfer, error) { return nil, errPermissionStorage }
func (TransferHistory) Record(drop.Transfer) error     { return errPermissionStorage }
func (TransferHistory) Delete(string) error            { return errPermissionStorage }

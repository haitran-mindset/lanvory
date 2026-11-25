//go:build !((darwin || linux) && cgo)

package storage

import syncengine "lanvory.local/core/internal/sync"

func SyncFolders(string, string) ([]syncengine.Folder, error) {
	return nil, errStorageUnavailable
}

func SaveSyncFolder(string, string, syncengine.Folder) error {
	return errStorageUnavailable
}

func SetSyncFolderPausedStorage(string, string, string, bool) error {
	return errStorageUnavailable
}

func DeleteSyncFolder(string, string, string) error {
	return errStorageUnavailable
}

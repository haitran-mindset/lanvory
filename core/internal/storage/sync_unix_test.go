//go:build (darwin || linux) && cgo

package storage

import (
	"testing"

	syncengine "lanvory.local/core/internal/sync"
)

func TestSyncFolderPersistence(t *testing.T) {
	dir := t.TempDir()
	owner := "ed25519-v1:test-sync-owner"
	if _, err := LoadProfile(dir, owner, "SyncHost"); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	folder := syncengine.Folder{
		ID:   "docs",
		Path: target,
		Mode: syncengine.ModeBidirectional,
	}
	if err := SaveSyncFolder(dir, owner, folder); err != nil {
		t.Fatalf("SaveSyncFolder failed: %v", err)
	}
	if err := SetSyncFolderPausedStorage(dir, owner, "docs", true); err != nil {
		t.Fatalf("SetSyncFolderPausedStorage failed: %v", err)
	}
	rows, err := SyncFolders(dir, owner)
	if err != nil {
		t.Fatalf("SyncFolders failed: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "docs" || !rows[0].Paused || rows[0].Path != target {
		t.Fatalf("unexpected rows: %+v", rows)
	}
	if err := DeleteSyncFolder(dir, owner, "docs"); err != nil {
		t.Fatalf("DeleteSyncFolder failed: %v", err)
	}
	rows, err = SyncFolders(dir, owner)
	if err != nil {
		t.Fatalf("SyncFolders after delete failed: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 rows after delete, got %+v", rows)
	}
}

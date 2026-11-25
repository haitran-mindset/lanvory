package syncengine

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSyncManagerScanAndVersioning(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.md"), []byte("v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Ignored hidden file and node_modules directory.
	if err := os.WriteFile(filepath.Join(root, ".DS_Store"), []byte("junk"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", "pkg.js"), []byte("ignored"), 0o600); err != nil {
		t.Fatal(err)
	}

	mgr := NewManager()
	if _, err := mgr.Add("docs", root, ModeBidirectional); err != nil {
		t.Fatalf("Add failed: %v", err)
	}

	scanned, err := mgr.Scan("docs")
	if err != nil {
		t.Fatalf("Scan failed: %v", err)
	}
	if scanned.FileCount != 1 || scanned.Files[0].RelativePath != "notes.md" || scanned.Files[0].Version != 1 {
		t.Fatalf("unexpected first scan result: %+v", scanned)
	}

	// Modify file content and re-scan -> version increments to 2.
	if err := os.WriteFile(filepath.Join(root, "notes.md"), []byte("v2"), 0o600); err != nil {
		t.Fatal(err)
	}
	scanned2, err := mgr.Scan("docs")
	if err != nil {
		t.Fatalf("second Scan failed: %v", err)
	}
	if scanned2.Files[0].Version != 2 {
		t.Fatalf("expected version 2 after content change, got %d", scanned2.Files[0].Version)
	}

	// Pause and remove.
	paused, err := mgr.SetPaused("docs", true)
	if err != nil || !paused.Paused {
		t.Fatalf("SetPaused failed: %+v, %v", paused, err)
	}
	if err := mgr.Remove("docs"); err != nil {
		t.Fatalf("Remove failed: %v", err)
	}
}

func TestConflictFilename(t *testing.T) {
	when := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	got := ConflictFilename("docs/document.md", "MacBook Pro", when)
	want := filepath.Join("docs", "document.conflict-macbook-pro-20261125.md")
	if got != want {
		t.Fatalf("ConflictFilename = %q, want %q", got, want)
	}
}

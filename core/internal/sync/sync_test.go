package syncengine

import (
	"context"
	"errors"
	"net"
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

func TestSyncProtocolBidirectionalExchangeAndAuthorization(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirA, "from-a.txt"), []byte("hello-a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirB, "from-b.txt"), []byte("hello-b"), 0o600); err != nil {
		t.Fatal(err)
	}

	mgrA := NewManager()
	if _, err := mgrA.Add("test", dirA, ModeBidirectional); err != nil {
		t.Fatal(err)
	}
	mgrB := NewManager()
	if _, err := mgrB.Add("test", dirB, ModeBidirectional); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Denied peer gets ErrSyncRejected.
	sConn, cConn := net.Pipe()
	srvErr := make(chan error, 1)
	go func() {
		defer sConn.Close()
		srvErr <- ServeConn(ctx, sConn, "peer-b", mgrA, func(fp, id string) bool { return false })
	}()
	if _, err := RunClientSync(ctx, cConn, mgrB, "test", "device-a"); !errors.Is(err, ErrSyncRejected) {
		t.Fatalf("expected ErrSyncRejected, got %v", err)
	}
	_ = cConn.Close()
	<-srvErr

	// Granted peer syncs bidirectionally.
	sConn2, cConn2 := net.Pipe()
	go func() {
		defer sConn2.Close()
		srvErr <- ServeConn(ctx, sConn2, "peer-b", mgrA, func(fp, id string) bool { return fp == "peer-b" && id == "test" })
	}()
	res, err := RunClientSync(ctx, cConn2, mgrB, "test", "device-a")
	_ = cConn2.Close()
	if err != nil {
		t.Fatalf("RunClientSync failed: %v", err)
	}
	if err := <-srvErr; err != nil {
		t.Fatalf("ServeConn failed: %v", err)
	}
	if res.Downloaded != 1 || res.Uploaded != 1 || res.Conflicts != 0 {
		t.Fatalf("unexpected sync result: %+v", res)
	}
	if got, err := os.ReadFile(filepath.Join(dirB, "from-a.txt")); err != nil || string(got) != "hello-a" {
		t.Fatalf("dirB missing from-a.txt: %q, %v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(dirA, "from-b.txt")); err != nil || string(got) != "hello-b" {
		t.Fatalf("dirA missing from-b.txt: %q, %v", got, err)
	}
}

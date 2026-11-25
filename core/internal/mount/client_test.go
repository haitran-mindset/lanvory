package mount

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestWebDAVClientStreamingAndReconcile(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	payload := make([]byte, 256*1024)
	for i := range payload {
		payload[i] = byte('A' + (i % 26))
	}
	if err := os.WriteFile(filepath.Join(root, "stream.bin"), payload, 0o600); err != nil {
		t.Fatal(err)
	}

	reg := NewRegistry()
	exp, err := reg.Add("media", root, false)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(ServeExport(exp))
	defer srv.Close()

	// 1. ListDirectory via Go WebDAV Client (PROPFIND)
	entries, err := ListDirectory(ctx, srv.Client(), srv.URL, "/")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "stream.bin" || entries[0].Size != int64(len(payload)) {
		t.Fatalf("unexpected PROPFIND entries: %+v", entries)
	}

	// 2. Streaming Engine: ReadRange + Adaptive Read-Ahead + Bounded Cache
	cache := NewStreamCache(1024 * 1024)
	chunk1, err := ReadRange(ctx, srv.Client(), cache, srv.URL, "/stream.bin", 0, 64*1024, entries[0].ETag)
	if err != nil {
		t.Fatal(err)
	}
	if chunk1.FromCache || len(chunk1.Data) != 64*1024 || chunk1.TotalSize != int64(len(payload)) {
		t.Fatalf("unexpected first chunk: len=%d total=%d cached=%v", len(chunk1.Data), chunk1.TotalSize, chunk1.FromCache)
	}
	// Second sequential window should hit read-ahead cache
	chunk2, err := ReadRange(ctx, srv.Client(), cache, srv.URL, "/stream.bin", 64*1024, 64*1024, entries[0].ETag)
	if err != nil {
		t.Fatal(err)
	}
	if !chunk2.FromCache || len(chunk2.Data) != 64*1024 {
		t.Fatalf("expected second sequential chunk from read-ahead cache, got cached=%v len=%d", chunk2.FromCache, len(chunk2.Data))
	}

	// 3. WebDAV write/mkdir/rename/delete via Go WebDAV Client
	if err := CreateDir(ctx, srv.Client(), srv.URL, "/docs"); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(ctx, srv.Client(), srv.URL, "/docs/a.txt", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := RenamePath(ctx, srv.Client(), srv.URL, "/docs/a.txt", "/docs/b.txt"); err != nil {
		t.Fatal(err)
	}
	if err := DeletePath(ctx, srv.Client(), srv.URL, "/docs/b.txt"); err != nil {
		t.Fatal(err)
	}

	// 4. Resource Event Engine: Reconcile detects external file creation
	if err := os.WriteFile(filepath.Join(root, "external.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	events := reg.Events().Reconcile(exp)
	foundCreated := false
	for _, ev := range events {
		if ev.Type == "file.created" && ev.Path == "/external.txt" {
			foundCreated = true
		}
	}
	if !foundCreated {
		t.Fatalf("expected file.created event from Reconcile, got %+v", events)
	}
}

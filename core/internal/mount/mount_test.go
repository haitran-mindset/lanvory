package mount

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebDAVRangeAndSecurity(t *testing.T) {
	root := t.TempDir()
	// Create a 1 MiB file to verify partial Range reads without downloading full file.
	payload := bytes.Repeat([]byte("0123456789ABCDEF"), 64*1024)
	if err := os.WriteFile(filepath.Join(root, "video.bin"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "docs"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "readme.txt"), []byte("hello mount"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Symlink escape attempt must be hidden/rejected.
	outside := t.TempDir()
	_ = os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("top-secret"), 0o600)
	_ = os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "escape.txt"))

	reg := NewRegistry()
	exp, err := reg.Add("media", root, true)
	if err != nil {
		t.Fatal(err)
	}
	handler := ServeExport(exp)

	// 1. PROPFIND Depth 1 lists directory without downloading video.bin.
	req := httptest.NewRequest("PROPFIND", "/", nil)
	req.Header.Set("Depth", "1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusMultiStatus {
		t.Fatalf("PROPFIND status = %d, want 207", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "video.bin") || !strings.Contains(body, "docs") {
		t.Fatalf("PROPFIND missing expected entries: %s", body)
	}
	if strings.Contains(body, "escape.txt") {
		t.Fatalf("PROPFIND leaked symlink entry: %s", body)
	}

	// 2. Range GET reads only requested byte slice (206 Partial Content).
	req = httptest.NewRequest(http.MethodGet, "/video.bin", nil)
	req.Header.Set("Range", "bytes=16-31")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("Range GET status = %d, want 206", rec.Code)
	}
	if rec.Body.String() != "0123456789ABCDEF" {
		t.Fatalf("Range GET body = %q, want 0123456789ABCDEF", rec.Body.String())
	}

	// 3. Symlink & path traversal rejection.
	for _, target := range []string{"/escape.txt", "/../outside"} {
		req = httptest.NewRequest(http.MethodGet, target, nil)
		rec = httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("GET %s status = %d, want 403", target, rec.Code)
		}
	}

	// 4. Read-only blocks PUT.
	req = httptest.NewRequest(http.MethodPut, "/new.txt", strings.NewReader("blocked"))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ReadOnly PUT status = %d, want 403", rec.Code)
	}

	// 5. Read-write allows PUT, MKCOL, DELETE.
	expRW := Export{ID: "media-rw", Path: root, ReadOnly: false}
	rwHandler := ServeExport(expRW)
	req = httptest.NewRequest(http.MethodPut, "/docs/edit.txt", strings.NewReader("updated"))
	rec = httptest.NewRecorder()
	rwHandler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("RW PUT status = %d, want 201", rec.Code)
	}
	got, err := os.ReadFile(filepath.Join(root, "docs", "edit.txt"))
	if err != nil || string(got) != "updated" {
		t.Fatalf("unexpected written file: %q, %v", string(got), err)
	}
}

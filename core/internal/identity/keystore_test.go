//go:build darwin || linux

package identity

import (
	"bytes"
	"crypto/ed25519"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCreatesAndPersistsPrivateKey(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}

	first, err := Load(dir)
	if err != nil {
		t.Fatalf("first Load: %v", err)
	}

	keyPath := filepath.Join(dir, keyFileName)
	info, err := os.Lstat(keyPath)
	if err != nil {
		t.Fatalf("stat key file: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("key file permissions: got %o, want 0600", info.Mode().Perm())
	}
	if info.Size() != ed25519.SeedSize {
		t.Fatalf("key file size: got %d, want %d", info.Size(), ed25519.SeedSize)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != keyFileName {
		t.Fatalf("unexpected files in state dir: %v", entries)
	}

	second, err := Load(dir)
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("reloaded private key does not match original")
	}
}

func TestLoadRejectsInvalidPermissionsAndSymlinks(t *testing.T) {
	t.Run("relative path", func(t *testing.T) {
		if _, err := Load("relative/dir"); err == nil {
			t.Fatal("expected error for relative dir")
		}
	})

	t.Run("non-private dir", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "state")
		if err := os.Mkdir(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir); err == nil {
			t.Fatal("expected error for 0755 dir")
		}
	})

	t.Run("permissive key file", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "state")
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir); err != nil {
			t.Fatal(err)
		}
		keyPath := filepath.Join(dir, keyFileName)
		if err := os.Chmod(keyPath, 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir); err == nil {
			t.Fatal("expected error for 0644 key file")
		}
	})

	t.Run("symlinked key file", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "state")
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(t.TempDir(), "target")
		if err := os.WriteFile(target, make([]byte, ed25519.SeedSize), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, filepath.Join(dir, keyFileName)); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir); err == nil {
			t.Fatal("expected error for symlinked key file")
		}
	})

	t.Run("corrupted key size", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "state")
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, keyFileName), []byte("short"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir); err == nil {
			t.Fatal("expected error for invalid key size")
		}
	})
}

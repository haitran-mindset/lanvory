//go:build linux && cgo

package identity

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestCredentialStoreInitializationLock(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cache)
	lock, err := lockCredentialStore()
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if other, err := lockCredentialStore(); !errors.Is(err, syscall.EWOULDBLOCK) {
		if other != nil {
			other.Close()
		}
		t.Fatalf("second lock: got %v, want EWOULDBLOCK", err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	lock, err = lockCredentialStore()
	if err != nil {
		t.Fatalf("reacquire after close: %v", err)
	}
	defer lock.Close()
	if err := os.Chmod(filepath.Join(cache, "lanvory", "identity"), 0755); err != nil {
		t.Fatal(err)
	}
	if other, err := lockCredentialStore(); other != nil || err == nil || errors.Is(err, syscall.EWOULDBLOCK) {
		if other != nil {
			other.Close()
		}
		t.Fatalf("non-private lock directory: got %v, want rejection before flock", err)
	}
}

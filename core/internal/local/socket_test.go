//go:build darwin || linux

package local

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
)

func TestIdentityRoundTrip(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "lanvory-ipc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	key, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	expected := Describe(key)
	listener, release, err := Listen(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if listener, unlock, err := Listen(dir); err == nil {
		listener.Close()
		unlock()
		t.Fatal("duplicate daemon acquired the socket")
	}
	server := &http.Server{Handler: Handler(expected, dir)}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	defer func() {
		server.Close()
		<-done
	}()
	actual, err := GetIdentity(context.Background(), dir)
	if err != nil || actual != expected {
		t.Fatalf("identity = %+v, error = %v", actual, err)
	}
	if runtime.GOOS == "darwin" {
		if _, err := storage.LoadProfile(dir, expected.ID, expected.Name); err != nil {
			t.Fatal(err)
		}
		interfaces, err := GetInterfaces(context.Background(), dir)
		if err != nil {
			t.Fatal(err)
		}
		scan, err := Discover(context.Background(), dir)
		if err != nil || scan.Interfaces == nil || scan.Services == nil || len(scan.Interfaces) != 0 || len(scan.Services) != 0 {
			t.Fatalf("default discovery = %+v, %v", scan, err)
		}
		policy, err := CheckNetworkScope(context.Background(), dir, "lanvory-test", "192.168.1.3")
		if err != nil || policy.Allowed || policy.Reason != "interface_not_active_and_approved" {
			t.Fatalf("default scope = %+v, %v", policy, err)
		}
		if _, err := CheckNetworkScope(context.Background(), dir, "lanvory-test", "example.local"); err == nil {
			t.Fatal("scope check accepted a hostname")
		}
		if _, err := ResolveDiscovery(context.Background(), dir, "lanvory-test", "Lanvory test"); err == nil || err.Error() != "interface is unavailable or ineligible" {
			t.Fatalf("unapproved resolve error = %v", err)
		}

		if err := VerifyPeer(context.Background(), dir, "lanvory-test", "192.168.1.3:443", strings.Repeat("a", 64)); !errors.Is(err, peer.ErrPeerScope) {
			t.Fatalf("unapproved peer verification error = %v", err)
		}

		if err := UpdateService(context.Background(), dir, "notes", "127.0.0.1:8080", true); err != nil {
			t.Fatal(err)
		}
		if err := UpdateService(context.Background(), dir, "notes", "192.168.1.3:8080", true); err == nil {
			t.Fatal("IPC accepted a non-loopback target")
		}
		services, err := ListServices(context.Background(), dir)
		if err != nil || len(services) != 1 || services[0].ID != "notes" || services[0].Target.String() != "127.0.0.1:8080" {
			t.Fatalf("services = %+v, %v", services, err)
		}
		if err := UpdateService(context.Background(), dir, "notes", "", false); err != nil {
			t.Fatal(err)
		}

		var candidate string
		for _, nic := range interfaces {
			if nic.Approved {
				t.Fatal("an interface was approved by default")
			}
			if nic.Loopback {
				if err := SetInterfaceApproval(context.Background(), dir, nic.Name, true); err == nil {
					t.Fatal("daemon approved loopback")
				}
			}
			if nic.Eligible && candidate == "" {
				candidate = nic.Name
			}
		}
		if name := os.Getenv("LANVORY_TEST_BONJOUR_INTERFACE"); name != "" {
			if err := SetInterfaceApproval(context.Background(), dir, name, true); err != nil {
				t.Fatal(err)
			}
			scan, err := Discover(context.Background(), dir)
			if err != nil || len(scan.Interfaces) != 1 || scan.Interfaces[0] != name {
				t.Fatalf("scoped Bonjour scan = %+v, %v", scan, err)
			}
			if err := SetInterfaceApproval(context.Background(), dir, name, false); err != nil {
				t.Fatal(err)
			}
			t.Log("Bonjour browse completed on the single test-approved interface")
		}
		if candidate != "" {
			for _, approved := range []bool{true, true, false, false} {
				if err := SetInterfaceApproval(context.Background(), dir, candidate, approved); err != nil {
					t.Fatal(err)
				}
				current, err := GetInterfaces(context.Background(), dir)
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, nic := range current {
					if nic.Name == candidate {
						found = true
						if nic.Approved != approved {
							t.Fatalf("approved = %t, want %t", nic.Approved, approved)
						}
					}
				}
				if !found {
					t.Fatal("approved test adapter disappeared")
				}
			}
		} else {
			t.Log("No eligible IPv4 adapter in this environment")
		}
	}
	info, err := os.Stat(filepath.Join(dir, "daemon.sock"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("socket permission = %o", info.Mode().Perm())
	}
}

func TestRejectInsecureDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, release, err := Listen(dir); err == nil {
		release()
		t.Fatal("listener accepted a shared directory")
	}
	if _, err := GetIdentity(context.Background(), dir); err == nil {
		t.Fatal("client accepted a shared directory")
	}
}

func TestPreserveNonSocketPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "daemon.sock")
	if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, release, err := Listen(dir); err == nil {
		release()
		t.Fatal("listener replaced an existing file")
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "keep" {
		t.Fatalf("socket path file changed: %q, %v", content, err)
	}
}

func TestExplicitStateDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	t.Setenv("LANVORY_STATE_DIR", dir)
	actual, err := Dir()
	if err != nil || actual != dir {
		t.Fatalf("state directory = %q,%v", actual, err)
	}
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := Dir(); err == nil {
		t.Fatal("accepted a shared state directory")
	}
	t.Setenv("LANVORY_STATE_DIR", "relative")
	if _, err := Dir(); err == nil {
		t.Fatal("accepted a relative state directory")
	}
}

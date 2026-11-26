//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lanvory.local/core/internal/drop"
)

func TestSendFileLoopbackUsesRegisteredBridgeAndWaitsForApproval(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	serverPublic, serverKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	sender := Fingerprint(sha256.Sum256(clientPublic))
	allowed := func(pin string) (bool, error) { return pin == sender.String(), nil }
	destination := t.TempDir()
	receiver := drop.NewReceiver(destination, allowed, nil)
	listener, err := ListenLoopback(ctx, serverKey, allowed, receiver, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- listener.Serve(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("serve: %v", err)
		}
	}()

	endpoint := netip.MustParseAddrPort(listener.Addr().String())
	registered := func(address string) bool { return address == endpoint.String() }
	trusted := func() (bool, error) { return true, nil }
	tracker := drop.NewReceiver(t.TempDir(), nil, nil).Tracker()
	pin := Fingerprint(sha256.Sum256(serverPublic))
	path := filepath.Join(t.TempDir(), "test.txt")
	if err := os.WriteFile(path, []byte("Direct connection"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := SendFileLoopback(ctx, endpoint, pin, clientKey, path, nil, trusted, tracker); !errors.Is(err, ErrPeerScope) {
		t.Fatalf("unregistered bridge: %v", err)
	}

	sent := make(chan error, 1)
	go func() {
		sent <- SendFileLoopback(ctx, endpoint, pin, clientKey, path, registered, trusted, tracker)
	}()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case err := <-sent:
			t.Fatalf("send finished before approval: %v", err)
		case <-ctx.Done():
			t.Fatal("no pending file offer")
		case <-tick.C:
			offers := receiver.Pending()
			if len(offers) == 0 {
				continue
			}
			if offers[0].Fingerprint != sender.String() {
				t.Fatal("pending offer did not use the authenticated identity")
			}
			if err := receiver.Decide(offers[0].ID, true); err != nil {
				t.Fatal(err)
			}
		}
		break
	}

	if err := <-sent; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(destination, drop.Inbox, "test.txt"))
	if err != nil || string(content) != "Direct connection" {
		t.Fatalf("unexpected received file: %q, %v", content, err)
	}
}

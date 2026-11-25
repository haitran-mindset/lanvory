package pairing

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

func TestPairingLimitsDuplicateAndIncorrectCodes(t *testing.T) {
	manager := New(func(string) error { t.Error("unexpected trust write"); return nil })
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	local, remote := net.Pipe()
	defer local.Close()
	defer remote.Close()
	result := make(chan error, 1)
	go func() {
		result <- manager.Exchange(ctx, local, "incoming", "peer", "source", [16]byte{1}, func() bool { return true })
	}()
	for len(manager.List()) == 0 {
		select {
		case <-ctx.Done():
			t.Fatal("pending request missing")
		case <-time.After(5 * time.Millisecond):
		}
	}
	request := manager.List()[0]
	duplicate, unused := net.Pipe()
	defer duplicate.Close()
	defer unused.Close()
	if err := manager.Exchange(ctx, duplicate, "incoming", "peer", "other", [16]byte{2}, func() bool { return true }); !errors.Is(err, ErrLimit) {
		t.Fatalf("duplicate attempt = %v", err)
	}
	for range 3 {
		if err := manager.Decide(request.ID, "wrong", true); !errors.Is(err, ErrCode) {
			t.Fatalf("wrong code = %v", err)
		}
	}
	if err := <-result; err == nil {
		t.Fatal("approved wrong code")
	}
	if len(manager.List()) != 0 {
		t.Fatal("cancelled request still visible")
	}
	if err := manager.Exchange(ctx, duplicate, "incoming", "different-peer", "source", [16]byte{3}, func() bool { return true }); !errors.Is(err, ErrLimit) {
		t.Fatalf("rapid retry = %v", err)
	}
}

func TestPairingExpiresWithoutConsent(t *testing.T) {
	manager := New(func(string) error { t.Error("expired consent unexpectedly wrote trust"); return nil })
	local, remote := net.Pipe()
	defer local.Close()
	defer remote.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	err := manager.Exchange(ctx, local, "outgoing", "peer", "source", [16]byte{}, func() bool { return true })
	if err == nil || len(manager.List()) != 0 {
		t.Fatalf("expiration result = %v", err)
	}
}

//go:build darwin && cgo

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/netip"
	"testing"

	"lanvory.local/core/internal/local"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/storage"
)

func TestListenerCanRestartWithoutIncomingPairing(t *testing.T) {
	dir := t.TempDir()
	interfaces, err := networking.Interfaces(nil)
	if err != nil {
		t.Fatal(err)
	}
	var adapter string
	var bind netip.AddrPort
	for _, nic := range interfaces {
		if !nic.Eligible {
			continue
		}
		for _, address := range nic.Addresses {
			prefix, err := netip.ParsePrefix(address)
			if err == nil && prefix.Addr().Is4() {
				adapter, bind = nic.Name, netip.AddrPortFrom(prefix.Addr(), 0)
				break
			}
		}
		if adapter != "" {
			break
		}
	}
	if adapter == "" {
		t.Skip("no eligible IPv4 LAN adapter")
	}
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	device := local.Describe(public)
	if _, err := storage.LoadProfile(dir, device.ID, device.Name); err != nil {
		t.Fatal(err)
	}
	approval, err := networking.ApprovalKey(adapter)
	if err != nil || approval == "" {
		t.Fatalf("adapter approval key unavailable: %v", err)
	}
	if err := storage.SetInterfaceApproval(dir, adapter, approval); err != nil {
		t.Fatal(err)
	}
	listener := &lanListener{parent: context.Background(), dir: dir, device: device, key: key, pairs: pairing.New(func(string) error { return nil })}
	defer listener.stop()
	for _, acceptPairing := range []bool{true, false} {
		if err := listener.start(adapter, bind, false, true, acceptPairing); err != nil {
			t.Fatal(err)
		}
		status := listener.status()
		if status.State != "listening" || status.Adapter != adapter || status.Pairing != acceptPairing {
			t.Fatalf("pairing %t: unexpected status %+v", acceptPairing, status)
		}
		listener.stop()
		if status := listener.status(); status.State != "stopped" || status.Pairing {
			t.Fatalf("unexpected stopped status %+v", status)
		}
	}
}

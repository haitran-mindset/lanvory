//go:build darwin

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"net/netip"
	"os"
	"slices"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"lanvory.local/core/internal/discovery"
	"lanvory.local/core/internal/networking"
)

func TestNativeBindingAndRevocation(t *testing.T) {
	name := os.Getenv("LANVORY_TEST_PEER_INTERFACE")
	if name == "" {
		t.Skip("set LANVORY_TEST_PEER_INTERFACE to opt in to a real listener")
	}
	inventory, err := networking.Interfaces(nil)
	if err != nil {
		t.Fatal(err)
	}
	var source netip.Addr
	var expectedIndex int
	var approved atomic.Bool
	approved.Store(true)
	read := func() ([]networking.Interface, error) {
		result := append([]networking.Interface(nil), inventory...)
		for i := range result {
			result[i].Approved = approved.Load() && result[i].Name == name
		}
		return result, nil
	}
	allowed, _ := read()
	for _, nic := range allowed {
		if nic.Name != name {
			continue
		}
		for _, address := range nic.Addresses {
			prefix, err := netip.ParsePrefix(address)
			if err == nil {
				expectedIndex = networking.ListenerIndex(allowed, name, prefix.Addr())
				if expectedIndex != 0 {
					source = prefix.Addr()
					break
				}
			}
		}
	}
	if !source.IsValid() {
		t.Fatal("no eligible IPv4 bind address on the requested adapter")
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	l, err := Listen(ctx, name, netip.AddrPortFrom(source, 0), key, read, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	raw, err := l.Listener.(*net.TCPListener).SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	index := 0
	var optionErr error
	if err := raw.Control(func(fd uintptr) {
		index, optionErr = syscall.GetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_BOUND_IF)
	}); err != nil {
		t.Fatal(err)
	}
	if optionErr != nil || index != expectedIndex {
		t.Fatalf("socket interface binding = %d, error = %v", index, optionErr)
	}
	if bound := netip.MustParseAddrPort(l.Addr().String()); bound.Addr() != source || bound.Port() == 0 {
		t.Fatal("socket did not bind the exact requested address")
	}
	done := make(chan error, 1)
	label := ""
	if os.Getenv("LANVORY_TEST_PEER_PUBLISH") == "1" {
		var nonce [8]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			t.Fatal(err)
		}
		label = fmt.Sprintf("Lanvory test %x", nonce)
		ready := make(chan struct{})
		go func() { done <- l.ServeAdvertised(ctx, label, func() { close(ready) }) }()
		select {
		case err := <-done:
			t.Fatalf("listener ended before publication: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ready:
		}
		result, err := discovery.Browse(ctx, allowed)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(result.Services, discovery.Service{Name: label, Interface: name, Transport: "tcp"}) {
			t.Fatal("scoped browse did not return the TCP publication")
		}
		resolution, err := discovery.ResolveTCP(ctx, label, name, read)
		if err != nil || len(resolution.Endpoints) != 0 || resolution.RejectedAddresses == 0 {
			t.Fatalf("expected local Bonjour address to resolve and be filtered: %+v, %v", resolution, err)
		}
		t.Log("resolved the TCP service and excluded its same-host address")

	} else {
		go func() { done <- l.Serve(ctx) }()
	}
	approved.Store(false)
	select {
	case err := <-done:
		if err != nil || ctx.Err() != nil {
			t.Fatalf("listener shutdown = %v, context = %v", err, ctx.Err())
		}
	case <-ctx.Done():
		t.Fatal("listener did not close after revocation")
	}
	if label != "" {
		// Bonjour caches PTR records briefly while processing withdrawal.
		for attempt := 0; attempt < 5; attempt++ {
			result, err := discovery.Browse(ctx, allowed)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Contains(result.Services, discovery.Service{Name: label, Interface: name, Transport: "tcp"}) {
				t.Logf("verified scoped TCP publication, browse and withdrawal after %d scan(s)", attempt+1)
				return
			}
		}
		t.Fatal("TCP publication remained after five post-revocation scans")
	}
}

func TestNativeQUICBindingAndRevocation(t *testing.T) {
	name := os.Getenv("LANVORY_TEST_PEER_INTERFACE")
	if name == "" {
		t.Skip("set LANVORY_TEST_PEER_INTERFACE to test a real adapter bind")
	}
	inventory, err := networking.Interfaces(nil)
	if err != nil {
		t.Fatal(err)
	}
	var permit atomic.Bool
	permit.Store(true)
	read := func() ([]networking.Interface, error) {
		result := append([]networking.Interface(nil), inventory...)
		for i := range result {
			result[i].Approved = permit.Load() && result[i].Name == name
		}
		return result, nil
	}
	approved, _ := read()
	var address netip.Addr
	var index int
	for _, nic := range approved {
		if nic.Name != name {
			continue
		}
		for _, input := range nic.Addresses {
			prefix, err := netip.ParsePrefix(input)
			if err != nil {
				continue
			}
			if candidate := networking.ListenerIndex(approved, name, prefix.Addr()); candidate > 0 {
				address, index = prefix.Addr(), candidate
				break
			}
		}
	}
	if index == 0 {
		t.Fatal("no eligible UDP source address")
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	listener, err := ListenQUIC(ctx, name, netip.AddrPortFrom(address, 0), key, read, func(string) (bool, error) { return false, nil }, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	raw, err := listener.socket.(*net.UDPConn).SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var actual int
	var optionErr error
	if err := raw.Control(func(fd uintptr) {
		actual, optionErr = syscall.GetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_BOUND_IF)
	}); err != nil {
		t.Fatal(err)
	}
	if actual != index || optionErr != nil {
		t.Fatalf("UDP bind index=%d, error=%v", actual, optionErr)
	}
	done := make(chan error, 1)
	label := ""
	if os.Getenv("LANVORY_TEST_PEER_PUBLISH") == "1" {
		var nonce [8]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			t.Fatal(err)
		}
		label = fmt.Sprintf("Lanvory UDP test %x", nonce)
		ready := make(chan struct{})
		go func() { done <- listener.ServeAdvertised(ctx, label, func() { close(ready) }) }()
		select {
		case <-ready:
		case err := <-done:
			t.Fatalf("publication stopped early: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		results, err := discovery.Browse(ctx, approved)
		if err != nil || !slices.Contains(results.Services, discovery.Service{Name: label, Interface: name, Transport: "udp"}) {
			t.Fatalf("scoped UDP publication was not discovered: %v", err)
		}
		result, err := discovery.Resolve(ctx, label, name, "udp", read)
		if err != nil || result.Transport != "udp" || len(result.Endpoints) != 0 || result.RejectedAddresses == 0 {
			t.Fatalf("UDP resolution did not exclude the same-host address: %+v, %v", result, err)
		}
	} else {
		go func() { done <- listener.Serve(ctx) }()
	}
	permit.Store(false)
	select {
	case err := <-done:
		if err != nil || ctx.Err() != nil {
			t.Fatalf("shutdown = %v, context = %v", err, ctx.Err())
		}
	case <-ctx.Done():
		t.Fatal("QUIC listener did not close after revocation")
	}
	if label != "" {
		for range 5 {
			result, err := discovery.Browse(ctx, approved)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Contains(result.Services, discovery.Service{Name: label, Interface: name, Transport: "udp"}) {
				t.Log("verified UDP registration, resolution and withdrawal")
				return
			}
		}
		t.Fatal("UDP registration remained after revocation")
	}
}

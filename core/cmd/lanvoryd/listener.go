//go:build darwin || linux

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"sync"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/discovery"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/local"
	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/screenshare"
	"lanvory.local/core/internal/storage"
	syncengine "lanvory.local/core/internal/sync"
)

type lanListener struct {
	parent        context.Context
	dir           string
	device        local.Device
	key           ed25519.PrivateKey
	receiver      *drop.Receiver
	pairs         *pairing.Manager
	clipboard     *clipboard.Buffer
	screenSignals *screenshare.Manager
	syncMgr       *syncengine.Manager
	mountReg      *mount.Registry

	mu        sync.Mutex
	current   local.ListenerStatus
	done      chan struct{}
	cancel    context.CancelFunc
	p2pPort   int
	p2pCancel context.CancelFunc
}

func (l *lanListener) status() local.ListenerStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.done == nil {
		return local.ListenerStatus{State: "local-only"}
	}
	select {
	case <-l.done:
		return local.ListenerStatus{State: "stopped", Adapter: l.current.Adapter, ServiceName: l.current.ServiceName}
	default:
		return l.current
	}
}

func (l *lanListener) stop() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cancel != nil {
		l.cancel()
		<-l.done
	}
}

func (l *lanListener) start(adapter string, bind netip.AddrPort, advertise, enableQUIC, enablePairing bool) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.done != nil {
		select {
		case <-l.done:
		default:
			return errors.New("LAN listener already running")
		}
	}
	if err := l.parent.Err(); err != nil {
		return err
	}
	label := ""
	if advertise {
		if !discovery.CanPublish {
			return errors.New("LAN discovery publication is unavailable in this build")
		}
		var random [8]byte
		if _, err := rand.Read(random[:]); err != nil {
			return fmt.Errorf("create Bonjour service label: %w", err)
		}
		label = fmt.Sprintf("Lanvory %x", random)
	}
	inventory := func() ([]networking.Interface, error) {
		approvals, err := storage.InterfaceApprovals(l.dir)
		if err != nil {
			return nil, err
		}
		return networking.Interfaces(approvals)
	}
	trusted := func(fingerprint string) (bool, error) { return storage.IsTrustedPeer(l.dir, l.device.ID, fingerprint) }
	lookup := func(fingerprint, id string) (bridge.Service, error) {
		return storage.AuthorizedService(l.dir, l.device.ID, fingerprint, id, time.Now())
	}
	var incoming *pairing.Manager
	if enablePairing {
		incoming = l.pairs
	}

	ctx, cancel := context.WithCancel(l.parent)
	tcp, err := peer.Listen(ctx, adapter, bind, l.key, inventory, trusted, l.receiver, lookup, incoming)
	if err != nil {
		cancel()
		return fmt.Errorf("start peer listener: %w", err)
	}
	tcp.EnableScreenSignaling(l.screenSignals)
	tcp.EnableServiceList(func(fingerprint string) ([]string, error) {
		return storage.AuthorizedServices(l.dir, l.device.ID, fingerprint, time.Now())
	})
	if l.clipboard != nil {
		tcp.EnableClipboard(l.clipboard, func(fingerprint string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint,
				Capability:  permissions.ClipboardShare,
				Resource:    "clipboard",
			}, time.Now())
			return err == nil && allowed
		})
	}
	if l.syncMgr != nil {
		tcp.EnableSync(l.syncMgr, func(fingerprint, folderID string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint,
				Capability:  permissions.FolderSync,
				Resource:    folderID,
			}, time.Now())
			return err == nil && allowed
		})
	}
	if l.mountReg != nil {
		tcp.EnableMount(l.mountReg, func(fingerprint, mountID string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint,
				Capability:  permissions.MountFolder,
				Resource:    mountID,
			}, time.Now())
			return err == nil && allowed
		})
	}
	address := netip.MustParseAddrPort(tcp.Addr().String())
	var udpDone chan struct{}
	if enableQUIC {
		udp, err := peer.ListenQUIC(ctx, adapter, address, l.key, inventory, trusted, l.receiver, lookup)
		if err != nil {
			cancel()
			tcp.Close()
			return fmt.Errorf("start QUIC peer listener: %w", err)
		}
		if l.clipboard != nil {
			udp.EnableClipboard(l.clipboard, func(fingerprint string) bool {
				allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
					Fingerprint: fingerprint,
					Capability:  permissions.ClipboardShare,
					Resource:    "clipboard",
				}, time.Now())
				return err == nil && allowed
			})
		}
		if l.mountReg != nil {
			udp.EnableMount(l.mountReg, func(fingerprint, mountID string) bool {
				allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
					Fingerprint: fingerprint,
					Capability:  permissions.MountFolder,
					Resource:    mountID,
				}, time.Now())
				return err == nil && allowed
			})
		}
		udpDone = make(chan struct{})
		go func() {
			defer close(udpDone)
			var err error
			if advertise {
				err = udp.ServeAdvertised(ctx, label, func() { fmt.Fprintln(os.Stderr, "lanvoryd: Bonjour UDP publication confirmed") })
			} else {
				err = udp.Serve(ctx)
			}
			if err != nil {
				fmt.Fprintln(os.Stderr, "lanvoryd: QUIC listener stopped:", err)
			}
		}()
		fmt.Fprintf(os.Stderr, "lanvoryd: QUIC peer listener started on UDP port %d\n", address.Port())
	}
	done := make(chan struct{})
	l.current = local.ListenerStatus{State: "listening", Adapter: adapter, Endpoint: address.String(), Pairing: enablePairing, ServiceName: label}
	l.done = done
	l.cancel = cancel
	go func() {
		defer close(done)
		var err error
		if advertise {
			err = tcp.ServeAdvertised(ctx, label, func() { fmt.Fprintln(os.Stderr, "lanvoryd: Bonjour TCP publication confirmed") })
		} else {
			err = tcp.Serve(ctx)
		}
		cancel()
		if udpDone != nil {
			<-udpDone
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "lanvoryd: peer listener or publication stopped:", err)
		}
	}()
	fmt.Fprintf(os.Stderr, "lanvoryd: experimental TLS listener started on port %d\n", address.Port())
	return nil
}

func (l *lanListener) ensureP2PPort() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.p2pPort > 0 {
		return l.p2pPort
	}
	trusted := func(fingerprint string) (bool, error) {
		return storage.IsTrustedPeer(l.dir, l.device.ID, fingerprint)
	}
	lookup := func(fingerprint, id string) (bridge.Service, error) {
		return storage.AuthorizedService(l.dir, l.device.ID, fingerprint, id, time.Now())
	}
	ctx, cancel := context.WithCancel(l.parent)
	loop, err := peer.ListenLoopback(ctx, l.key, trusted, l.receiver, lookup, l.pairs)
	if err != nil {
		cancel()
		return 0
	}
	loop.EnableServiceList(func(fingerprint string) ([]string, error) {
		return storage.AuthorizedServices(l.dir, l.device.ID, fingerprint, time.Now())
	})
	if l.clipboard != nil {
		loop.EnableClipboard(l.clipboard, func(fingerprint string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint, Capability: permissions.ClipboardShare, Resource: "clipboard",
			}, time.Now())
			return err == nil && allowed
		})
	}
	if l.syncMgr != nil {
		loop.EnableSync(l.syncMgr, func(fingerprint, folderID string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint, Capability: permissions.FolderSync, Resource: folderID,
			}, time.Now())
			return err == nil && allowed
		})
	}
	if l.mountReg != nil {
		loop.EnableMount(l.mountReg, func(fingerprint, mountID string) bool {
			allowed, err := storage.HasGrant(l.dir, l.device.ID, storage.Grant{
				Fingerprint: fingerprint, Capability: permissions.MountFolder, Resource: mountID,
			}, time.Now())
			return err == nil && allowed
		})
	}
	addr := netip.MustParseAddrPort(loop.Addr().String())
	l.p2pPort = int(addr.Port())
	l.p2pCancel = cancel
	go func() {
		_ = loop.Serve(ctx)
		cancel()
		l.mu.Lock()
		if l.p2pCancel != nil {
			l.p2pPort = 0
			l.p2pCancel = nil
		}
		l.mu.Unlock()
	}()
	return int(addr.Port())
}

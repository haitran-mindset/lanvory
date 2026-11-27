//go:build darwin || linux

package main

import (
	"context"
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/clipboard"
	"lanvory.local/core/internal/drop"
	"lanvory.local/core/internal/identity"
	"lanvory.local/core/internal/local"
	"lanvory.local/core/internal/mount"
	"lanvory.local/core/internal/nearby"
	"lanvory.local/core/internal/pairing"
	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/screenshare"
	"lanvory.local/core/internal/storage"
	syncengine "lanvory.local/core/internal/sync"
)

var buildVersion = "development"

func main() {
	name := flag.String("peer-interface", "", "approved adapter for the experimental peer TLS listener")
	address := flag.String("peer-bind", "", "exact IPv4:port for the experimental peer TLS listener")
	advertise := flag.Bool("peer-advertise", false, "publish the experimental TCP listener on the approved adapter")
	enableQUIC := flag.Bool("peer-quic", false, "also enable the authenticated QUIC listener on the same UDP port")
	enablePairing := flag.Bool("peer-pairing", false, "allow scoped incoming pairing requests")
	flag.Parse()
	if flag.NArg() != 0 || (*name == "") != (*address == "") || ((*advertise || *enableQUIC || *enablePairing) && *name == "") {
		flag.Usage()
		os.Exit(2)
	}
	var bind netip.AddrPort
	if *address != "" {
		var err error
		bind, err = netip.ParseAddrPort(*address)
		if err != nil || !bind.Addr().Is4() {
			fmt.Fprintln(os.Stderr, "lanvoryd: --peer-bind requires an IPv4 address and port")
			os.Exit(2)
		}
	}
	if err := run(*name, bind, *advertise, *enableQUIC, *enablePairing); err != nil {
		fmt.Fprintln(os.Stderr, "lanvoryd:", err)
		os.Exit(1)
	}
}

func run(peerInterface string, peerBind netip.AddrPort, advertise, enableQUIC, enablePairing bool) error {
	dir, err := local.Dir()
	if err != nil {
		return err
	}
	listener, release, err := local.Listen(dir)
	if err != nil {
		return err
	}
	defer release()
	key, err := identity.Load(dir)
	if err != nil {
		return err
	}
	defer clear(key)
	device := local.Describe(key.Public().(ed25519.PublicKey))
	device.DaemonVersion = buildVersion
	profile, err := storage.LoadProfile(dir, device.ID, device.Name)
	if err != nil {
		return err
	}
	device.Name = profile.Name
	device.CreatedAt = profile.CreatedAt
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	receiver := drop.NewReceiver(dir, func(fingerprint string) (bool, error) {
		return storage.HasGrant(dir, device.ID, storage.Grant{
			Fingerprint: fingerprint, Capability: permissions.ReceiveFile, Resource: drop.Inbox,
		}, time.Now())
	}, storage.NewTransferHistory(dir, device.ID))
	pairs := pairing.New(func(pin string) error {
		if pin == device.Fingerprint {
			return pairing.ErrUnavailable
		}
		return storage.SetPeerTrust(dir, device.ID, pin, true)
	})
	clipBuf := clipboard.NewBuffer()
	var screenSignals *screenshare.Manager
	if runtime.GOOS == "darwin" {
		screenSignals = screenshare.New()
	}
	syncMgr := syncengine.NewManager()
	mountReg := mount.NewRegistry()
	nearbyMgr := nearby.NewManager(device.Name, device.Fingerprint[:12])
	defer nearbyMgr.Close()
	lan := &lanListener{parent: ctx, dir: dir, device: device, key: key, receiver: receiver, pairs: pairs, clipboard: clipBuf, screenSignals: screenSignals, syncMgr: syncMgr, mountReg: mountReg}
	defer lan.stop()
	if peerInterface != "" {
		if err := lan.start(peerInterface, peerBind, advertise, enableQUIC, enablePairing); err != nil {
			return err
		}
	}
	tunnels := bridge.NewTunnels()
	defer tunnels.Close()
	handler := local.WithListenerStatus(local.HandlerWithResources(device, dir, receiver, tunnels, key, pairs, lan.status, nearbyMgr.HasEndpoint), lan.status, lan.start, lan.stop)
	handler = local.WithClipboardWithNearby(handler, clipBuf, device, dir, key, nearbyMgr.HasEndpoint)
	handler = local.WithScreenSignaling(handler, screenSignals, device, dir, key, nearbyMgr.HasEndpoint)
	handler = local.WithSyncWithNearby(handler, syncMgr, device, dir, key, nearbyMgr.HasEndpoint)
	handler = local.WithMountsWithNearby(handler, mountReg, device, dir, key, nearbyMgr)
	handler = local.WithNearby(handler, nearbyMgr, lan.ensureP2PPort, device, dir, key, pairs)
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       3 * time.Second,
		WriteTimeout:      3 * time.Second,
		IdleTimeout:       3 * time.Second,
		MaxHeaderBytes:    4096,
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			return err
		}
		if err := <-done; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

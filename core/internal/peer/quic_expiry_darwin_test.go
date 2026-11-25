//go:build darwin && cgo

package peer

import (
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/storage"
)

func TestQUICBridgeClosesWhenStoredGrantExpires(t *testing.T) {
	dir := t.TempDir()
	const owner = "test-owner"
	if _, err := storage.LoadProfile(dir, owner, "Test device"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Truncate(time.Second)
	expiry := now.Add(time.Hour)
	var clock atomic.Int64
	clock.Store(now.Unix())

	testQUICBridgeGrantEnds(t, func(target netip.AddrPort) (bridge.Lookup, func()) {
		const serviceID = "echo"
		if err := storage.RegisterService(dir, owner, bridge.Service{ID: serviceID, Target: target}); err != nil {
			t.Fatal(err)
		}
		var once sync.Once
		var setupErr error
		lookup := func(pin, id string) (bridge.Service, error) {
			once.Do(func() {
				setupErr = storage.SetPeerTrust(dir, owner, pin, true)
				if setupErr == nil {
					setupErr = storage.SetGrant(dir, owner, storage.Grant{
						Fingerprint: pin, Capability: permissions.ConnectService, Resource: serviceID, ExpiresAt: &expiry,
					}, true)
				}
			})
			if setupErr != nil {
				return bridge.Service{}, setupErr
			}
			return storage.AuthorizedService(dir, owner, pin, id, time.Unix(clock.Load(), 0))
		}
		return lookup, func() { clock.Store(expiry.Unix()) }
	})
}

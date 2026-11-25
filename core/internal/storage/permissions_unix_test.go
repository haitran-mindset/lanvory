//go:build (darwin || linux) && cgo

package storage

import (
	"errors"
	"net/netip"
	"testing"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/permissions"
)

func TestResourceGrantLifecycle(t *testing.T) {
	dir := t.TempDir()
	const owner = "owner-a"
	if _, err := LoadProfile(dir, owner, "Device"); err != nil {
		t.Fatal(err)
	}
	grant := Grant{Fingerprint: "peer-key", Capability: permissions.ConnectService, Resource: "notes"}
	now := time.Now().UTC().Truncate(time.Second)
	expiry := now.Add(time.Hour)
	grant.ExpiresAt = &expiry
	check := func(ownerID string, resource Grant, at time.Time, want bool) {
		t.Helper()
		if allowed, err := HasGrant(dir, ownerID, resource, at); err != nil || allowed != want {
			t.Fatalf("HasGrant(%s, %s, %s) = %t, %v; want %t", ownerID, resource.Capability, resource.Resource, allowed, err, want)
		}
	}
	check(owner, grant, now, false)
	if err := SetGrant(dir, owner, grant, true); !errors.Is(err, ErrUntrustedPeer) {
		t.Fatalf("untrusted grant = %v", err)
	}
	if err := SetPeerTrust(dir, owner, grant.Fingerprint, true); err != nil {
		t.Fatal(err)
	}
	if err := RegisterService(dir, owner, bridge.Service{ID: "notes", Target: netip.MustParseAddrPort("127.0.0.1:8080")}); err != nil {
		t.Fatal(err)
	}
	check(owner, grant, now, false)
	for range 2 {
		if err := SetGrant(dir, owner, grant, true); err != nil {
			t.Fatal(err)
		}
	}
	check(owner, grant, now, true)
	check(owner, grant, expiry, false)
	check("owner-b", grant, now, false)
	different := grant
	different.Resource = "private"
	check(owner, different, now, false)
	different = grant
	different.Capability = permissions.ReceiveFile
	check(owner, different, now, false)

	grant.ExpiresAt = nil
	if err := SetGrant(dir, owner, grant, true); err != nil {
		t.Fatal(err)
	}
	check(owner, grant, expiry.Add(time.Hour), true)
	listed, err := Grants(dir, owner)
	if err != nil || len(listed) != 1 || listed[0] != grant {
		t.Fatalf("list = %+v, %v", listed, err)
	}
	if err := SetPeerTrust(dir, owner, grant.Fingerprint, false); err != nil {
		t.Fatal(err)
	}
	check(owner, grant, now, false)
	if err := SetPeerTrust(dir, owner, grant.Fingerprint, true); err != nil {
		t.Fatal(err)
	}
	check(owner, grant, now, false)
	events, err := PermissionEvents(dir, owner)
	if err != nil || len(events) != 3 || events[0].Action != "revoked" ||
		events[1].Action != "updated" || events[2].Action != "granted" {
		t.Fatalf("audit = %+v, %v", events, err)
	}
}

func TestUpgradeTrustStoreDoesNotGrantResources(t *testing.T) {
	dir := t.TempDir()
	const owner = "owner-a"
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, schemaV1+schemaV2+`
        CREATE TABLE trusted_peers (owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL, verified_at INTEGER NOT NULL,
            PRIMARY KEY(owner_id, fingerprint));
        INSERT INTO trusted_peers VALUES ('owner-a', 'known-peer', 1);
        PRAGMA user_version = 3;`)
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, owner, "Device"); err != nil {
		t.Fatal(err)
	}
	if trusted, err := IsTrustedPeer(dir, owner, "known-peer"); err != nil || !trusted {
		t.Fatalf("existing trust = %t, %v", trusted, err)
	}
	if records, err := Grants(dir, owner); err != nil || len(records) != 0 {
		t.Fatalf("existing permissions = %v, %v", records, err)
	}
}

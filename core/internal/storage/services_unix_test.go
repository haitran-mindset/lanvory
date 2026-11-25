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

func TestSharedServiceAuthorization(t *testing.T) {
	dir := t.TempDir()
	const owner = "local"
	if _, err := LoadProfile(dir, owner, "Device"); err != nil {
		t.Fatal(err)
	}
	grant := Grant{Fingerprint: "peer-pin", Capability: permissions.ConnectService, Resource: "notes"}
	if err := SetPeerTrust(dir, owner, grant.Fingerprint, true); err != nil {
		t.Fatal(err)
	}
	service := bridge.Service{ID: grant.Resource, Target: netip.MustParseAddrPort("127.0.0.1:8080")}
	denied := func() {
		t.Helper()
		if _, err := AuthorizedService(dir, owner, grant.Fingerprint, service.ID, time.Now()); !errors.Is(err, bridge.ErrNotAvailable) {
			t.Fatalf("expected denial, got %v", err)
		}
	}
	if err := SetGrant(dir, owner, grant, true); !errors.Is(err, bridge.ErrNotAvailable) {
		t.Fatalf("grant without service = %v", err)
	}
	if err := RegisterService(dir, owner, bridge.Service{ID: service.ID, Target: netip.MustParseAddrPort("192.168.1.5:8080")}); !errors.Is(err, bridge.ErrNotAvailable) {
		t.Fatalf("non-loopback registration = %v", err)
	}
	for range 2 {
		if err := RegisterService(dir, owner, service); err != nil {
			t.Fatal(err)
		}
	}
	denied()
	if err := SetGrant(dir, owner, grant, true); err != nil {
		t.Fatal(err)
	}
	if current, err := AuthorizedService(dir, owner, grant.Fingerprint, service.ID, time.Now()); err != nil || current != service {
		t.Fatalf("current = %+v, %v", current, err)
	}
	if _, err := AuthorizedService(dir, "other-owner", grant.Fingerprint, service.ID, time.Now()); !errors.Is(err, bridge.ErrNotAvailable) {
		t.Fatalf("owner isolation error=%v", err)
	}
	updated := bridge.Service{ID: service.ID, Target: netip.MustParseAddrPort("[::1]:9090")}
	if err := RegisterService(dir, owner, updated); !errors.Is(err, bridge.ErrServiceExists) {
		t.Fatalf("target replacement = %v", err)
	}
	if err := RemoveService(dir, owner, service.ID); err != nil {
		t.Fatal(err)
	}
	if err := RegisterService(dir, owner, updated); err != nil {
		t.Fatal(err)
	}
	denied()
	if records, err := SharedServices(dir, owner); err != nil || len(records) != 1 || records[0] != updated {
		t.Fatalf("service registry = %+v, %v", records, err)
	}
	if err := SetGrant(dir, owner, grant, true); err != nil {
		t.Fatal(err)
	}
	if err := SetPeerTrust(dir, owner, grant.Fingerprint, false); err != nil {
		t.Fatal(err)
	}
	denied()
}

func TestLegacyGrantDoesNotPassThroughToNewService(t *testing.T) {
	dir := t.TempDir()
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, schemaV1+schemaV2+`
        CREATE TABLE trusted_peers (owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL, verified_at INTEGER NOT NULL, PRIMARY KEY(owner_id,fingerprint));
        INSERT INTO trusted_peers VALUES ('owner','peer',1);`+schemaV4+schemaV5+`
        INSERT INTO peer_grants VALUES ('owner','peer','service-connect','example',NULL);`)
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, "owner", "Device"); err != nil {
		t.Fatal(err)
	}
	records, err := Grants(dir, "owner")
	if err != nil || len(records) != 1 || !records[0].Inactive {
		t.Fatalf("legacy grants were not preserved: %v %v", records, err)
	}
	service := bridge.Service{ID: "example", Target: netip.MustParseAddrPort("127.0.0.1:9000")}
	if err := RegisterService(dir, "owner", service); err != nil {
		t.Fatal(err)
	}
	if _, err := AuthorizedService(dir, "owner", "peer", service.ID, time.Now()); !errors.Is(err, bridge.ErrNotAvailable) {
		t.Fatalf("legacy grant was silently activated: %v", err)
	}
	if err := SetGrant(dir, "owner", records[0], true); err != nil {
		t.Fatal(err)
	}
	if current, err := AuthorizedService(dir, "owner", "peer", service.ID, time.Now()); err != nil || current != service {
		t.Fatalf("renewed grant = %+v, %v", current, err)
	}
}

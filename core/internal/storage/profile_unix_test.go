//go:build (darwin || linux) && cgo

package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadProfilePersistsInitialMetadata(t *testing.T) {
	dir := t.TempDir()
	created, err := LoadProfile(dir, "device-a", "Original name")
	if err != nil || created.Name != "Original name" || created.CreatedAt.IsZero() {
		t.Fatalf("first load = %+v, %v", created, err)
	}
	restored, err := LoadProfile(dir, "device-a", "Changed hostname")
	if err != nil || restored != created {
		t.Fatalf("second load = %+v, %v", restored, err)
	}
	other, err := LoadProfile(dir, "device-b", "Second identity")
	if err != nil || other.Name != "Second identity" {
		t.Fatalf("new identity = %+v, %v", other, err)
	}
}

func TestDatabasePathRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "state.sqlite3")); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, "device-a", "Device"); err == nil {
		t.Fatal("database accepted a symlink")
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "preserve" {
		t.Fatalf("unexpected target content %q, %v", content, err)
	}
}

func TestDatabaseFileIsPrivateOnCreationAndReopen(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "state.sqlite3")
	first, err := LoadProfile(dir, "device-a", "Original")
	if err != nil {
		t.Fatal(err)
	}
	checkMode := func() {
		t.Helper()
		info, err := os.Stat(filename)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0600 {
			t.Fatalf("database mode = %o, want 600", got)
		}
	}
	checkMode()
	if err := os.Chmod(filename, 0644); err != nil {
		t.Fatal(err)
	}
	reopened, err := LoadProfile(dir, "device-a", "Different")
	if err != nil || reopened != first {
		t.Fatalf("reopened profile = %+v, %v", reopened, err)
	}
	checkMode()
}

func TestDatabasePathRejectsHardLink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("preserve"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(target, filepath.Join(dir, "state.sqlite3")); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, "device-a", "Device"); err == nil {
		t.Fatal("database accepted a hard link")
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "preserve" {
		t.Fatalf("unexpected target content %q, %v", content, err)
	}
}

func TestMigrateV1AndPersistInterfaceApproval(t *testing.T) {
	dir := t.TempDir()
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, schemaV1+"INSERT INTO device_profiles VALUES ('device-a', 'Original', 42);")
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := LoadProfile(dir, "device-a", "New name")
	if err != nil || profile.Name != "Original" || profile.CreatedAt.Unix() != 42 {
		t.Fatalf("migrated profile = %+v, %v", profile, err)
	}
	initial, err := InterfaceApprovals(dir)
	if err != nil || len(initial) != 0 {
		t.Fatalf("initial approvals = %v, %v", initial, err)
	}
	if err := SetInterfaceApproval(dir, "en0", "adapter-a"); err != nil {
		t.Fatal(err)
	}
	persisted, err := InterfaceApprovals(dir)
	if err != nil || persisted["en0"] != "adapter-a" {
		t.Fatalf("saved approvals = %v, %v", persisted, err)
	}
	if err := SetInterfaceApproval(dir, "en0", ""); err != nil {
		t.Fatal(err)
	}
	if err := SetInterfaceApproval(dir, "en0", ""); err != nil {
		t.Fatal(err)
	}
	revoked, err := InterfaceApprovals(dir)
	if err != nil || len(revoked) != 0 {
		t.Fatalf("revoked approvals = %v, %v", revoked, err)
	}
}

func TestLoadProfileRejectsNewerSchemaWithoutChangingProfile(t *testing.T) {
	dir := t.TempDir()
	original, err := LoadProfile(dir, "owner", "Original")
	if err != nil {
		t.Fatal(err)
	}
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, "PRAGMA user_version = 999")
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := LoadProfile(dir, "owner", "Replacement"); err == nil || !strings.Contains(err.Error(), "schema version 999") {
			t.Fatalf("load newer database = %v", err)
		}
	}
	db, err = openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer closeState(db)
	if existing, err := readProfile(db, "owner"); err != nil || existing != original {
		t.Fatalf("profile after rejected upgrade = %+v, %v", existing, err)
	}
}

func TestFailedMigrationRollsBackEarlierSchemaChanges(t *testing.T) {
	dir := t.TempDir()
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, "CREATE TABLE interface_approvals (sentinel TEXT)")
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, "owner", "Device"); err == nil {
		t.Fatal("migration unexpectedly succeeded with conflicting table")
	}
	db, err = openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	// V1 creates device_profiles before V2 encounters the conflict.
	err = command(db, "CREATE TABLE device_profiles (sentinel TEXT); DROP TABLE device_profiles; DROP TABLE interface_approvals")
	closeState(db)
	if err != nil {
		t.Fatalf("failed migration left an earlier schema change: %v", err)
	}
	if _, err := LoadProfile(dir, "owner", "Device"); err != nil {
		t.Fatalf("retry after resolving the conflict: %v", err)
	}
}

func TestTrustMigrationAndOwnerIsolation(t *testing.T) {
	dir := t.TempDir()
	db, err := openState(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = command(db, schemaV1+schemaV2+"INSERT INTO interface_approvals VALUES ('en0', 'old-adapter');")
	closeState(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProfile(dir, "owner-a", "Device"); err != nil {
		t.Fatal(err)
	}
	approvals, err := InterfaceApprovals(dir)
	if err != nil || approvals["en0"] != "old-adapter" {
		t.Fatalf("migrated approvals = %v, %v", approvals, err)
	}

	for range 2 {
		if err := SetPeerTrust(dir, "owner-a", "peer-pin", true); err != nil {
			t.Fatal(err)
		}
	}
	records, err := TrustedPeers(dir, "owner-a")
	if err != nil || len(records) != 1 || records[0].Fingerprint != "peer-pin" || records[0].VerifiedAt.IsZero() {
		t.Fatalf("trusted peers = %+v, %v", records, err)
	}
	if trusted, err := IsTrustedPeer(dir, "owner-b", "peer-pin"); err != nil || trusted {
		t.Fatalf("other owner trust = %t, %v", trusted, err)
	}
	if err := SetPeerTrust(dir, "owner-a", "peer-pin", false); err != nil {
		t.Fatal(err)
	}
	if trusted, err := IsTrustedPeer(dir, "owner-a", "peer-pin"); err != nil || trusted {
		t.Fatalf("revoked trust = %t, %v", trusted, err)
	}
}

func TestRenameProfileKeepsCreationMetadataAndOwner(t *testing.T) {
	dir := t.TempDir()
	original, err := LoadProfile(dir, "owner", "Initial")
	if err != nil {
		t.Fatal(err)
	}
	other, err := LoadProfile(dir, "other", "Another device")
	if err != nil {
		t.Fatal(err)
	}
	if err := RenameProfile(dir, "owner", "  Máy A  "); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"  ", "line\x00break", "format​", strings.Repeat("é", 32)} {
		if err := RenameProfile(dir, "owner", name); err != ErrInvalidProfileName {
			t.Fatalf("rename %q: %v", name, err)
		}
	}
	updated, err := LoadProfile(dir, "owner", "Fallback")
	if err != nil || updated.Name != "Máy A" || !updated.CreatedAt.Equal(original.CreatedAt) {
		t.Fatalf("reloaded owner: %+v, %v", updated, err)
	}
	untouched, err := LoadProfile(dir, "other", "Fallback")
	if err != nil || untouched != other {
		t.Fatalf("reloaded other owner: %+v, %v", untouched, err)
	}
}

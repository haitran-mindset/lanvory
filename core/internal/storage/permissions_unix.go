//go:build (darwin || linux) && cgo

package storage

/*
#include <sqlite3.h>
*/
import "C"

import (
	"fmt"
	"time"
	"unsafe"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/permissions"
)

const schemaV4 = `
CREATE TABLE peer_grants (
    owner_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    capability TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER,
    PRIMARY KEY (owner_id, fingerprint, capability, resource),
    FOREIGN KEY (owner_id, fingerprint) REFERENCES trusted_peers(owner_id, fingerprint) ON DELETE CASCADE
);
CREATE TABLE permission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    capability TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER,
    action TEXT NOT NULL,
    occurred_at INTEGER NOT NULL
);
CREATE INDEX permission_events_owner ON permission_events(owner_id, id);
CREATE TRIGGER grant_audit_insert AFTER INSERT ON peer_grants BEGIN
    INSERT INTO permission_events (owner_id, fingerprint, capability, resource, expires_at, action, occurred_at)
    VALUES (NEW.owner_id, NEW.fingerprint, NEW.capability, NEW.resource, NEW.expires_at, 'granted', unixepoch());
END;
CREATE TRIGGER grant_audit_update AFTER UPDATE ON peer_grants WHEN OLD.expires_at IS NOT NEW.expires_at BEGIN
    INSERT INTO permission_events (owner_id, fingerprint, capability, resource, expires_at, action, occurred_at)
    VALUES (NEW.owner_id, NEW.fingerprint, NEW.capability, NEW.resource, NEW.expires_at, 'updated', unixepoch());
END;
CREATE TRIGGER grant_audit_delete AFTER DELETE ON peer_grants BEGIN
    INSERT INTO permission_events (owner_id, fingerprint, capability, resource, expires_at, action, occurred_at)
    VALUES (OLD.owner_id, OLD.fingerprint, OLD.capability, OLD.resource, OLD.expires_at, 'revoked', unixepoch());
END;
CREATE TRIGGER grant_audit_retention AFTER INSERT ON permission_events BEGIN
    DELETE FROM permission_events WHERE owner_id = NEW.owner_id AND id IN (
        SELECT id FROM permission_events WHERE owner_id = NEW.owner_id ORDER BY id DESC LIMIT -1 OFFSET 1000
    );
END;
PRAGMA user_version = 4;`

func SetGrant(dir, owner string, grant Grant, allow bool) error {
	if !permissions.ValidResource(grant.Capability, grant.Resource) {
		return fmt.Errorf("invalid permission capability or resource")
	}
	if allow && grant.ExpiresAt != nil && grant.ExpiresAt.Unix() <= time.Now().Unix() {
		return fmt.Errorf("permission expiration must be in the future")
	}
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	if err := command(db, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer command(db, "ROLLBACK")
	if allow {
		trusted, err := hasTrustedPeer(db, owner, grant.Fingerprint)
		if err != nil {
			return err
		}
		if !trusted {
			return ErrUntrustedPeer
		}
		if grant.Capability == permissions.ConnectService {
			service, err := findService(db, owner, grant.Resource)
			if err != nil {
				return err
			}
			if service.ID == "" {
				return bridge.ErrNotAvailable
			}
		}

	}
	query := `DELETE FROM peer_grants WHERE owner_id=? AND fingerprint=? AND capability=? AND resource=?`
	if allow {
		query = `INSERT INTO peer_grants (owner_id, fingerprint, capability, resource, expires_at, service_bound)
            SELECT ?1, ?2, ?3, ?4, ?5, (?3 = 'service-connect')
            WHERE EXISTS(SELECT 1 FROM peer_grants WHERE owner_id=?1 AND fingerprint=?2 AND capability=?3 AND resource=?4)
                OR (SELECT COUNT(*) FROM peer_grants WHERE owner_id=?1) < 256
            ON CONFLICT(owner_id,fingerprint,capability,resource)
            DO UPDATE SET expires_at=excluded.expires_at, service_bound=excluded.service_bound`
	}
	statement, err := prepare(db, query)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bindGrant(statement, owner, grant); err != nil {
		return err
	}
	if allow && grant.ExpiresAt != nil {
		if code := C.sqlite3_bind_int64(statement, 5, C.sqlite3_int64(grant.ExpiresAt.Unix())); code != C.SQLITE_OK {
			return fmt.Errorf("bind grant expiration: SQLite code %d", code)
		}
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("write permission grant: SQLite code %d", code)
	}
	if allow && C.sqlite3_changes(db) == 0 {
		return ErrGrantLimit
	}
	return command(db, "COMMIT")
}

// HasGrant denies absent and expired permissions. The peer grant is deleted
// by SQLite when its parent trusted peer is revoked.
func HasGrant(dir, owner string, grant Grant, now time.Time) (bool, error) {
	if !permissions.ValidResource(grant.Capability, grant.Resource) {
		return false, nil
	}
	db, err := openState(dir)
	if err != nil {
		return false, err
	}
	defer closeState(db)
	statement, err := prepare(db, `SELECT 1 FROM peer_grants
        WHERE owner_id=? AND fingerprint=? AND capability=? AND resource=?
        AND (expires_at IS NULL OR expires_at > ?)
        AND (capability != 'service-connect' OR service_bound=1)`)
	if err != nil {
		return false, err
	}
	defer C.sqlite3_finalize(statement)
	if err := bindGrant(statement, owner, grant); err != nil {
		return false, err
	}
	if code := C.sqlite3_bind_int64(statement, 5, C.sqlite3_int64(now.Unix())); code != C.SQLITE_OK {
		return false, fmt.Errorf("bind permission check time: SQLite code %d", code)
	}
	switch code := C.sqlite3_step(statement); code {
	case C.SQLITE_ROW:
		return true, nil
	case C.SQLITE_DONE:
		return false, nil
	default:
		return false, fmt.Errorf("check permission grant: SQLite code %d", code)
	}
}

func Grants(dir, owner string) ([]Grant, error) {
	records := []Grant{}
	err := readOwnerRows(dir, owner, `SELECT fingerprint, capability, resource, expires_at,
        CASE WHEN capability='service-connect' AND service_bound=0 THEN 1 ELSE 0 END
        FROM peer_grants WHERE owner_id=? ORDER BY fingerprint, capability, resource`, func(row *C.sqlite3_stmt) {
		grant := readGrant(row)
		grant.Inactive = C.sqlite3_column_int(row, 4) != 0
		records = append(records, grant)
	})
	return records, err
}

func PermissionEvents(dir, owner string) ([]PermissionEvent, error) {
	records := []PermissionEvent{}
	err := readOwnerRows(dir, owner, `SELECT fingerprint, capability, resource, expires_at, action, occurred_at
        FROM permission_events WHERE owner_id=? ORDER BY id DESC LIMIT 100`, func(row *C.sqlite3_stmt) {
		records = append(records, PermissionEvent{
			Grant:      readGrant(row),
			Action:     C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 4)))),
			OccurredAt: time.Unix(int64(C.sqlite3_column_int64(row, 5)), 0).UTC(),
		})
	})
	return records, err
}

func bindGrant(statement *C.sqlite3_stmt, owner string, grant Grant) error {
	for i, value := range []string{owner, grant.Fingerprint, grant.Capability, grant.Resource} {
		if err := bind(statement, i+1, value); err != nil {
			return err
		}
	}
	return nil
}

func readGrant(row *C.sqlite3_stmt) Grant {
	grant := Grant{
		Fingerprint: C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 0)))),
		Capability:  C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 1)))),
		Resource:    C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 2)))),
	}
	if C.sqlite3_column_type(row, 3) != C.SQLITE_NULL {
		expires := time.Unix(int64(C.sqlite3_column_int64(row, 3)), 0).UTC()
		grant.ExpiresAt = &expires
	}
	return grant
}

func readOwnerRows(dir, owner, query string, consume func(*C.sqlite3_stmt)) error {
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	statement, err := prepare(db, query)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, owner); err != nil {
		return err
	}
	for {
		switch code := C.sqlite3_step(statement); code {
		case C.SQLITE_DONE:
			return nil
		case C.SQLITE_ROW:
			consume(statement)
		default:
			return fmt.Errorf("read local database rows: SQLite code %d", code)
		}
	}
}

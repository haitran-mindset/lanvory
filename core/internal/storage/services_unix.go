//go:build (darwin || linux) && cgo

package storage

/*
#include <sqlite3.h>
*/
import "C"

import (
	"fmt"
	"net/netip"
	"time"
	"unsafe"

	"lanvory.local/core/internal/bridge"
)

const schemaV6 = `
CREATE TABLE shared_services (
    owner_id TEXT NOT NULL,
    id TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY(owner_id,id)
);
PRAGMA user_version=6;`

const schemaV7 = `
ALTER TABLE peer_grants ADD COLUMN service_bound INTEGER NOT NULL DEFAULT 0;
UPDATE peer_grants SET service_bound=1 WHERE capability='service-connect' AND EXISTS (
    SELECT 1 FROM shared_services s WHERE s.owner_id=peer_grants.owner_id AND s.id=peer_grants.resource
);
DROP TRIGGER grant_audit_update;
CREATE TRIGGER grant_audit_update AFTER UPDATE ON peer_grants
WHEN OLD.expires_at IS NOT NEW.expires_at OR OLD.service_bound IS NOT NEW.service_bound BEGIN
    INSERT INTO permission_events (owner_id,fingerprint,capability,resource,expires_at,action,occurred_at)
    VALUES (NEW.owner_id,NEW.fingerprint,NEW.capability,NEW.resource,NEW.expires_at,'updated',unixepoch());
END;
PRAGMA user_version=7;`

func SharedServices(dir, owner string) ([]bridge.Service, error) {
	services := []bridge.Service{}
	var invalid bool
	err := readOwnerRows(dir, owner, "SELECT id,target FROM shared_services WHERE owner_id=? ORDER BY id", func(row *C.sqlite3_stmt) {
		service, ok := serviceRow(row)
		if !ok {
			invalid = true
			return
		}
		services = append(services, service)
	})
	if err == nil && invalid {
		err = fmt.Errorf("invalid stored shared service")
	}
	return services, err
}

func RegisterService(dir, owner string, service bridge.Service) error {
	if !bridge.ValidID(service.ID) || !bridge.ValidTarget(service.Target) {
		return bridge.ErrNotAvailable
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
	existing, err := findService(db, owner, service.ID)
	if err != nil {
		return err
	}
	if existing.ID != "" {
		if existing.Target != service.Target {
			return bridge.ErrServiceExists
		}
		return nil
	}
	statement, err := prepare(db, `INSERT INTO shared_services (owner_id,id,target)
        SELECT ?1,?2,?3 WHERE (SELECT COUNT(*) FROM shared_services WHERE owner_id=?1)<100`)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	for i, value := range []string{owner, service.ID, service.Target.String()} {
		if err := bind(statement, i+1, value); err != nil {
			return err
		}
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("register shared service: SQLite code %d", code)
	}
	if C.sqlite3_changes(db) == 0 {
		return bridge.ErrServiceLimit
	}
	return command(db, "COMMIT")
}

func RemoveService(dir, owner, id string) error {
	if !bridge.ValidID(id) {
		return bridge.ErrNotAvailable
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
	for _, query := range []string{
		"DELETE FROM peer_grants WHERE owner_id=? AND resource=? AND capability='service-connect'",
		"DELETE FROM shared_services WHERE owner_id=? AND id=?",
	} {
		statement, err := prepare(db, query)
		if err != nil {
			return err
		}
		defer C.sqlite3_finalize(statement)
		if err := bind(statement, 1, owner); err != nil {
			return err
		}
		if err := bind(statement, 2, id); err != nil {
			return err
		}
		if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
			return fmt.Errorf("remove shared service: SQLite code %d", code)
		}
	}
	return command(db, "COMMIT")
}

func AuthorizedService(dir, owner, fingerprint, id string, now time.Time) (bridge.Service, error) {
	if !bridge.ValidID(id) {
		return bridge.Service{}, bridge.ErrNotAvailable
	}
	db, err := openState(dir)
	if err != nil {
		return bridge.Service{}, err
	}
	defer closeState(db)
	statement, err := prepare(db, `SELECT s.id,s.target FROM shared_services s
        JOIN peer_grants g ON g.owner_id=s.owner_id AND g.resource=s.id AND g.capability='service-connect' AND g.service_bound=1
        JOIN trusted_peers p ON p.owner_id=g.owner_id AND p.fingerprint=g.fingerprint
        WHERE s.owner_id=? AND s.id=? AND g.fingerprint=?
        AND (g.expires_at IS NULL OR g.expires_at > ?)`)
	if err != nil {
		return bridge.Service{}, err
	}
	defer C.sqlite3_finalize(statement)
	for i, value := range []string{owner, id, fingerprint} {
		if err := bind(statement, i+1, value); err != nil {
			return bridge.Service{}, err
		}
	}
	if code := C.sqlite3_bind_int64(statement, 4, C.sqlite3_int64(now.Unix())); code != C.SQLITE_OK {
		return bridge.Service{}, fmt.Errorf("bind service check time: SQLite code %d", code)
	}
	service, err := readService(statement)
	if err == nil && service.ID == "" {
		err = bridge.ErrNotAvailable
	}
	return service, err
}

func AuthorizedServices(dir, owner, fingerprint string, now time.Time) ([]string, error) {
	db, err := openState(dir)
	if err != nil {
		return nil, err
	}
	defer closeState(db)
	statement, err := prepare(db, `SELECT s.id FROM shared_services s
        JOIN peer_grants g ON g.owner_id=s.owner_id AND g.resource=s.id AND g.capability='service-connect' AND g.service_bound=1
        JOIN trusted_peers p ON p.owner_id=g.owner_id AND p.fingerprint=g.fingerprint
        WHERE s.owner_id=? AND g.fingerprint=?
        AND (g.expires_at IS NULL OR g.expires_at > ?)
        ORDER BY s.id`)
	if err != nil {
		return nil, err
	}
	defer C.sqlite3_finalize(statement)
	for i, value := range []string{owner, fingerprint} {
		if err := bind(statement, i+1, value); err != nil {
			return nil, err
		}
	}
	if code := C.sqlite3_bind_int64(statement, 3, C.sqlite3_int64(now.Unix())); code != C.SQLITE_OK {
		return nil, fmt.Errorf("bind service list check time: SQLite code %d", code)
	}
	ids := []string{}
	for {
		step := C.sqlite3_step(statement)
		if step == C.SQLITE_DONE {
			break
		}
		if step != C.SQLITE_ROW {
			return nil, fmt.Errorf("read authorized services: SQLite code %d", step)
		}
		ids = append(ids, C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(statement, 0)))))
	}
	return ids, nil
}

func findService(db *C.sqlite3, owner, id string) (bridge.Service, error) {
	statement, err := prepare(db, "SELECT id,target FROM shared_services WHERE owner_id=? AND id=?")
	if err != nil {
		return bridge.Service{}, err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, owner); err != nil {
		return bridge.Service{}, err
	}
	if err := bind(statement, 2, id); err != nil {
		return bridge.Service{}, err
	}
	return readService(statement)
}

func readService(statement *C.sqlite3_stmt) (bridge.Service, error) {
	switch code := C.sqlite3_step(statement); code {
	case C.SQLITE_ROW:
		service, ok := serviceRow(statement)
		if !ok {
			return bridge.Service{}, fmt.Errorf("invalid stored shared service")
		}
		return service, nil
	case C.SQLITE_DONE:
		return bridge.Service{}, nil
	default:
		return bridge.Service{}, fmt.Errorf("read shared service: SQLite code %d", code)
	}
}

func serviceRow(row *C.sqlite3_stmt) (bridge.Service, bool) {
	id := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 0))))
	endpoint := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 1))))
	target, err := netip.ParseAddrPort(endpoint)
	return bridge.Service{ID: id, Target: target}, err == nil && bridge.ValidID(id) && bridge.ValidTarget(target)
}

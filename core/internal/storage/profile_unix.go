//go:build (darwin || linux) && cgo

package storage

/*
#cgo LDFLAGS: -lsqlite3
#include <sqlite3.h>
#include <stdlib.h>

static int bindText(sqlite3_stmt *statement, int parameter, const char *value) {
    return sqlite3_bind_text(statement, parameter, value, -1, SQLITE_TRANSIENT);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const schemaV1 = `
CREATE TABLE IF NOT EXISTS device_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
PRAGMA user_version = 1;`

const schemaV2 = `
CREATE TABLE interface_approvals (name TEXT PRIMARY KEY, adapter TEXT NOT NULL);
PRAGMA user_version = 2;`

func openState(dir string) (*C.sqlite3, error) {
	// macOS commonly places the data directory under an alias such as /var.
	// Resolve the parent while keeping SQLite's symlink protection on the database.
	canonicalDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve database directory: %w", err)
	}
	path := C.CString(filepath.Join(canonicalDir, "state.sqlite3"))
	defer C.free(unsafe.Pointer(path))
	var db *C.sqlite3
	flags := C.int(C.SQLITE_OPEN_READWRITE | C.SQLITE_OPEN_CREATE | C.SQLITE_OPEN_NOFOLLOW | C.SQLITE_OPEN_EXRESCODE)
	code := C.sqlite3_open_v2(path, &db, flags, nil)
	if code != C.SQLITE_OK {
		if db != nil {
			C.sqlite3_close(db)
		}
		return nil, fmt.Errorf("open local database: SQLite code %d", code)
	}
	if code := C.sqlite3_busy_timeout(db, 1000); code != C.SQLITE_OK {
		C.sqlite3_close(db)
		return nil, fmt.Errorf("set SQLite busy timeout: code %d", code)
	}
	if err := command(db, "PRAGMA foreign_keys = ON"); err != nil {
		C.sqlite3_close(db)
		return nil, err
	}
	return db, nil
}

func closeState(db *C.sqlite3) {
	C.sqlite3_close(db)
}

func LoadProfile(dir, id, name string) (Profile, error) {
	// Prepare the file at startup, before SQLite opens any connections.
	if err := prepareStateFile(dir); err != nil {
		return Profile{}, err
	}
	db, err := openState(dir)
	if err != nil {
		return Profile{}, err
	}
	defer closeState(db)
	if err := command(db, "BEGIN IMMEDIATE"); err != nil {
		return Profile{}, err
	}
	defer command(db, "ROLLBACK")
	if err := migrate(db); err != nil {
		return Profile{}, err
	}
	if err := insertProfile(db, id, name); err != nil {
		return Profile{}, err
	}
	profile, err := readProfile(db, id)
	if err != nil {
		return Profile{}, err
	}
	if err := command(db, "COMMIT"); err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func prepareStateFile(dir string) error {
	file, err := os.OpenFile(filepath.Join(dir, "state.sqlite3"),
		os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return fmt.Errorf("prepare local database: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect local database: %w", err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 {
		return errors.New("local database must be a regular file owned by the current user with one link")
	}
	if info.Mode().Perm() != 0600 {
		if err := file.Chmod(0600); err != nil {
			return fmt.Errorf("restrict local database permissions: %w", err)
		}
	}
	return nil
}

func RenameProfile(dir, id, name string) error {
	name, err := NormalizeProfileName(name)
	if err != nil {
		return err
	}
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	statement, err := prepare(db, "UPDATE device_profiles SET name = ? WHERE id = ?")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, name); err != nil {
		return err
	}
	if err := bind(statement, 2, id); err != nil {
		return err
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("rename device profile: SQLite code %d", code)
	}
	if C.sqlite3_changes(db) != 1 {
		return errors.New("device profile not found")
	}
	return nil
}

func migrate(db *C.sqlite3) error {
	statement, err := prepare(db, "PRAGMA user_version")
	if err != nil {
		return err
	}
	code := C.sqlite3_step(statement)
	version := C.sqlite3_column_int(statement, 0)
	C.sqlite3_finalize(statement)
	if code != C.SQLITE_ROW {
		return fmt.Errorf("read database version: SQLite code %d", code)
	}
	switch version {
	case 0:
		if err := command(db, schemaV1); err != nil {
			return err
		}
		fallthrough
	case 1:
		if err := command(db, schemaV2); err != nil {
			return err
		}
		fallthrough
	case 2:
		if err := command(db, `
            CREATE TABLE trusted_peers (
                owner_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                verified_at INTEGER NOT NULL,
                PRIMARY KEY(owner_id, fingerprint)
            );
            PRAGMA user_version = 3;
        `); err != nil {
			return err
		}
		fallthrough
	case 3:
		if err := command(db, schemaV4); err != nil {
			return err
		}
		fallthrough
	case 4:
		if err := command(db, schemaV5); err != nil {
			return err
		}
		fallthrough
	case 5:
		if err := command(db, schemaV6); err != nil {
			return err
		}
		fallthrough
	case 6:
		return command(db, schemaV7)
	case 7:
		return nil
	default:
		return fmt.Errorf("unsupported local database schema version %d", version)
	}
}

func insertProfile(db *C.sqlite3, id, name string) error {
	statement, err := prepare(db, "INSERT INTO device_profiles VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, id); err != nil {
		return err
	}
	if err := bind(statement, 2, name); err != nil {
		return err
	}
	if C.sqlite3_bind_int64(statement, 3, C.sqlite3_int64(time.Now().Unix())) != C.SQLITE_OK {
		return errors.New("bind profile timestamp")
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("insert device profile: SQLite code %d", code)
	}
	return nil
}

func readProfile(db *C.sqlite3, id string) (Profile, error) {
	statement, err := prepare(db, "SELECT name, created_at FROM device_profiles WHERE id = ?")
	if err != nil {
		return Profile{}, err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, id); err != nil {
		return Profile{}, err
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_ROW {
		return Profile{}, fmt.Errorf("read device profile: SQLite code %d", code)
	}
	name := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(statement, 0))))
	createdAt := time.Unix(int64(C.sqlite3_column_int64(statement, 1)), 0).UTC()
	return Profile{Name: name, CreatedAt: createdAt}, nil
}

func prepare(db *C.sqlite3, sql string) (*C.sqlite3_stmt, error) {
	query := C.CString(sql)
	defer C.free(unsafe.Pointer(query))
	var statement *C.sqlite3_stmt
	if code := C.sqlite3_prepare_v2(db, query, -1, &statement, nil); code != C.SQLITE_OK {
		return nil, fmt.Errorf("prepare local query: SQLite code %d", code)
	}
	return statement, nil
}

func command(db *C.sqlite3, sql string) error {
	query := C.CString(sql)
	defer C.free(unsafe.Pointer(query))
	if code := C.sqlite3_exec(db, query, nil, nil, nil); code != C.SQLITE_OK {
		return fmt.Errorf("execute local query: SQLite code %d", code)
	}
	return nil
}

func bind(statement *C.sqlite3_stmt, parameter int, value string) error {
	input := C.CString(value)
	defer C.free(unsafe.Pointer(input))
	if code := C.bindText(statement, C.int(parameter), input); code != C.SQLITE_OK {
		return fmt.Errorf("bind local query: SQLite code %d", code)
	}
	return nil
}

func InterfaceApprovals(dir string) (map[string]string, error) {
	db, err := openState(dir)
	if err != nil {
		return nil, err
	}
	defer closeState(db)
	statement, err := prepare(db, "SELECT name, adapter FROM interface_approvals")
	if err != nil {
		return nil, err
	}
	defer C.sqlite3_finalize(statement)
	approvals := make(map[string]string)
	for {
		switch code := C.sqlite3_step(statement); code {
		case C.SQLITE_DONE:
			return approvals, nil
		case C.SQLITE_ROW:
			name := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(statement, 0))))
			adapter := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(statement, 1))))
			approvals[name] = adapter
		default:
			return nil, fmt.Errorf("read interface approvals: SQLite code %d", code)
		}
	}
}

// SetInterfaceApproval removes the approval when adapter is empty.
func SetInterfaceApproval(dir, name, adapter string) error {
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	query := "DELETE FROM interface_approvals WHERE name = ?"
	if adapter != "" {
		query = "INSERT INTO interface_approvals (name, adapter) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET adapter = excluded.adapter"
	}
	statement, err := prepare(db, query)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, name); err != nil {
		return err
	}
	if adapter != "" {
		if err := bind(statement, 2, adapter); err != nil {
			return err
		}
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("write interface approval: SQLite code %d", code)
	}
	return nil
}

func TrustedPeers(dir, owner string) ([]TrustedPeer, error) {
	db, err := openState(dir)
	if err != nil {
		return nil, err
	}
	defer closeState(db)
	statement, err := prepare(db, "SELECT fingerprint, verified_at FROM trusted_peers WHERE owner_id = ? ORDER BY fingerprint")
	if err != nil {
		return nil, err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, owner); err != nil {
		return nil, err
	}
	records := []TrustedPeer{}
	for {
		switch code := C.sqlite3_step(statement); code {
		case C.SQLITE_DONE:
			return records, nil
		case C.SQLITE_ROW:
			fingerprint := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(statement, 0))))
			verified := time.Unix(int64(C.sqlite3_column_int64(statement, 1)), 0).UTC()
			records = append(records, TrustedPeer{Fingerprint: fingerprint, VerifiedAt: verified})
		default:
			return nil, fmt.Errorf("read trusted peers: SQLite code %d", code)
		}
	}
}

// SetPeerTrust removes a peer when trusted is false.
func SetPeerTrust(dir, owner, fingerprint string, trusted bool) error {
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	query := "DELETE FROM trusted_peers WHERE owner_id = ? AND fingerprint = ?"
	if trusted {
		query = `INSERT INTO trusted_peers (owner_id, fingerprint, verified_at)
            SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM trusted_peers WHERE owner_id = ?1) < 256
            ON CONFLICT(owner_id, fingerprint) DO NOTHING`
	}
	statement, err := prepare(db, query)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, owner); err != nil {
		return err
	}
	if err := bind(statement, 2, fingerprint); err != nil {
		return err
	}
	if trusted && C.sqlite3_bind_int64(statement, 3, C.sqlite3_int64(time.Now().Unix())) != C.SQLITE_OK {
		return errors.New("bind trust timestamp")
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("write trusted peer: SQLite code %d", code)
	}
	if trusted && C.sqlite3_changes(db) == 0 {
		exists, err := hasTrustedPeer(db, owner, fingerprint)
		if err != nil {
			return err
		}
		if !exists {
			return ErrTrustLimit
		}
	}
	return nil
}

func IsTrustedPeer(dir, owner, fingerprint string) (bool, error) {
	db, err := openState(dir)
	if err != nil {
		return false, err
	}
	defer closeState(db)
	return hasTrustedPeer(db, owner, fingerprint)
}

func hasTrustedPeer(db *C.sqlite3, owner, fingerprint string) (bool, error) {
	statement, err := prepare(db, "SELECT 1 FROM trusted_peers WHERE owner_id = ? AND fingerprint = ?")
	if err != nil {
		return false, err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, owner); err != nil {
		return false, err
	}
	if err := bind(statement, 2, fingerprint); err != nil {
		return false, err
	}
	switch code := C.sqlite3_step(statement); code {
	case C.SQLITE_ROW:
		return true, nil
	case C.SQLITE_DONE:
		return false, nil
	default:
		return false, fmt.Errorf("find trusted peer: SQLite code %d", code)
	}
}

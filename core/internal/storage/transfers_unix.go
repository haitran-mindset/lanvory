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

	"lanvory.local/core/internal/drop"
)

const schemaV5 = `
CREATE TABLE transfers (
    owner_id TEXT NOT NULL,
    id TEXT NOT NULL,
    direction TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    state TEXT NOT NULL,
    updated_ns INTEGER NOT NULL,
    PRIMARY KEY(owner_id, id)
);
CREATE INDEX transfers_owner_latest ON transfers(owner_id, updated_ns DESC, id DESC);
PRAGMA user_version = 5;`

func (h TransferHistory) Load() ([]drop.Transfer, error) {
	records := []drop.Transfer{}
	err := readOwnerRows(h.dir, h.owner, fmt.Sprintf(`SELECT id,direction,fingerprint,name,size,bytes,state,updated_ns
        FROM transfers WHERE owner_id=? ORDER BY updated_ns DESC,id DESC LIMIT %d`, drop.HistoryLimit), func(row *C.sqlite3_stmt) {
		text := func(i C.int) string { return C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, i)))) }
		records = append(records, drop.Transfer{
			ID: text(0), Direction: text(1), Fingerprint: text(2), Name: text(3),
			Size: int64(C.sqlite3_column_int64(row, 4)), Bytes: int64(C.sqlite3_column_int64(row, 5)),
			State: text(6), UpdatedAt: time.Unix(0, int64(C.sqlite3_column_int64(row, 7))).UTC(),
		})
	})
	return records, err
}

func (h TransferHistory) Delete(id string) error {
	db, err := openState(h.dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	statement, err := prepare(db, "DELETE FROM transfers WHERE owner_id=? AND id=?")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, h.owner); err != nil {
		return err
	}
	if err := bind(statement, 2, id); err != nil {
		return err
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("delete transfer history: SQLite code %d", code)
	}
	return nil
}

func (h TransferHistory) Clear() error {
	db, err := openState(h.dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	statement, err := prepare(db, "DELETE FROM transfers WHERE owner_id=?")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	if err := bind(statement, 1, h.owner); err != nil {
		return err
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("clear transfer history: SQLite code %d", code)
	}
	return nil
}

func (h TransferHistory) Record(item drop.Transfer) error {
	db, err := openState(h.dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	if err := command(db, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer command(db, "ROLLBACK")
	statement, err := prepare(db, `INSERT INTO transfers (owner_id,id,direction,fingerprint,name,size,bytes,state,updated_ns)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	for i, value := range []string{h.owner, item.ID, item.Direction, item.Fingerprint, item.Name} {
		if err := bind(statement, i+1, value); err != nil {
			return err
		}
	}
	if err := bind(statement, 8, item.State); err != nil {
		return err
	}
	for index, value := range map[int]int64{6: item.Size, 7: item.Bytes, 9: item.UpdatedAt.UnixNano()} {
		if code := C.sqlite3_bind_int64(statement, C.int(index), C.sqlite3_int64(value)); code != C.SQLITE_OK {
			return fmt.Errorf("bind transfer field: SQLite code %d", code)
		}
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("save transfer history: SQLite code %d", code)
	}
	trim, err := prepare(db, fmt.Sprintf(`DELETE FROM transfers WHERE owner_id=?1 AND id IN (
        SELECT id FROM transfers WHERE owner_id=?1 ORDER BY updated_ns DESC,id DESC LIMIT -1 OFFSET %d
    )`, drop.HistoryLimit))
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(trim)
	if err := bind(trim, 1, h.owner); err != nil {
		return err
	}
	if code := C.sqlite3_step(trim); code != C.SQLITE_DONE {
		return fmt.Errorf("trim transfer history: SQLite code %d", code)
	}
	return command(db, "COMMIT")
}

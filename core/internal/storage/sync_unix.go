//go:build (darwin || linux) && cgo

package storage

/*
#include <sqlite3.h>
*/
import "C"

import (
	"fmt"
	"unsafe"

	syncengine "lanvory.local/core/internal/sync"
)

const schemaV8 = `
CREATE TABLE sync_folders (
    owner_id TEXT NOT NULL,
    id TEXT NOT NULL,
    path TEXT NOT NULL,
    mode TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id, id)
);
PRAGMA user_version=8;`

func SyncFolders(dir, owner string) ([]syncengine.Folder, error) {
	folders := []syncengine.Folder{}
	var invalid bool
	err := readOwnerRows(dir, owner, "SELECT id,path,mode,paused FROM sync_folders WHERE owner_id=? ORDER BY id", func(row *C.sqlite3_stmt) {
		id := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 0))))
		folderPath := C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 1))))
		mode := syncengine.Mode(C.GoString((*C.char)(unsafe.Pointer(C.sqlite3_column_text(row, 2)))))
		paused := C.sqlite3_column_int(row, 3) != 0
		if !syncengine.ValidID(id) || !syncengine.ValidMode(mode) || folderPath == "" {
			invalid = true
			return
		}
		folders = append(folders, syncengine.Folder{
			ID:     id,
			Path:   folderPath,
			Mode:   mode,
			Paused: paused,
		})
	})
	if err == nil && invalid {
		err = fmt.Errorf("invalid stored sync folder")
	}
	return folders, err
}

func SaveSyncFolder(dir, owner string, folder syncengine.Folder) error {
	if !syncengine.ValidID(folder.ID) || !syncengine.ValidMode(folder.Mode) || folder.Path == "" {
		return syncengine.ErrInvalidFolderID
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
	statement, err := prepare(db, `INSERT INTO sync_folders (owner_id,id,path,mode,paused)
        SELECT ?1,?2,?3,?4,?5 WHERE (SELECT COUNT(*) FROM sync_folders WHERE owner_id=?1)<100`)
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	for i, value := range []string{owner, folder.ID, folder.Path, string(folder.Mode)} {
		if err := bind(statement, i+1, value); err != nil {
			return err
		}
	}
	pausedInt := C.int(0)
	if folder.Paused {
		pausedInt = 1
	}
	if C.sqlite3_bind_int(statement, 5, pausedInt) != C.SQLITE_OK {
		return fmt.Errorf("bind paused flag")
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("save sync folder: SQLite code %d", code)
	}
	if C.sqlite3_changes(db) == 0 {
		return fmt.Errorf("sync folder limit reached")
	}
	return command(db, "COMMIT")
}

func SetSyncFolderPausedStorage(dir, owner, id string, paused bool) error {
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	if err := command(db, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer command(db, "ROLLBACK")
	statement, err := prepare(db, "UPDATE sync_folders SET paused=?1 WHERE owner_id=?2 AND id=?3")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(statement)
	pausedInt := C.int(0)
	if paused {
		pausedInt = 1
	}
	if C.sqlite3_bind_int(statement, 1, pausedInt) != C.SQLITE_OK {
		return fmt.Errorf("bind paused flag")
	}
	if err := bind(statement, 2, owner); err != nil {
		return err
	}
	if err := bind(statement, 3, id); err != nil {
		return err
	}
	if code := C.sqlite3_step(statement); code != C.SQLITE_DONE {
		return fmt.Errorf("update sync folder pause: SQLite code %d", code)
	}
	return command(db, "COMMIT")
}

func DeleteSyncFolder(dir, owner, id string) error {
	db, err := openState(dir)
	if err != nil {
		return err
	}
	defer closeState(db)
	if err := command(db, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer command(db, "ROLLBACK")
	statement, err := prepare(db, "DELETE FROM sync_folders WHERE owner_id=?1 AND id=?2")
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
		return fmt.Errorf("delete sync folder: SQLite code %d", code)
	}
	return command(db, "COMMIT")
}

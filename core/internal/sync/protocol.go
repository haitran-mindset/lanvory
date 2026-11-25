package syncengine

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const Protocol = "lanvory-sync/1"

const (
	opDone byte = 0
	opGet  byte = 1
	opPut  byte = 2
)

const (
	syncFrameTimeout = 30 * time.Second
	maxManifestBytes = 8 * 1024 * 1024
	MaxFileSize      = 1 << 30
)

var (
	ErrSyncRejected = errors.New("peer denied folder sync or folder is paused")
	ErrSyncPath     = errors.New("unsafe sync file path")
)

type remoteManifest struct {
	Mode  Mode        `json:"mode"`
	Files []FileEntry `json:"files"`
}

type SyncResult struct {
	FolderID   string `json:"folderId"`
	Downloaded int    `json:"downloaded"`
	Uploaded   int    `json:"uploaded"`
	Conflicts  int    `json:"conflicts"`
	Skipped    int    `json:"skipped"`
	Folder     Folder `json:"folder"`
}

// ResolveSafePath resolves relPath inside root, rejecting traversal, hidden/ignored components, and symlinks.
func ResolveSafePath(root, relPath string) (string, error) {
	if relPath == "" || strings.ContainsRune(relPath, 0) {
		return "", ErrSyncPath
	}
	slash := filepath.ToSlash(relPath)
	if strings.HasPrefix(slash, "/") {
		return "", ErrSyncPath
	}
	parts := strings.Split(slash, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || ignoredNames[part] || strings.HasPrefix(part, ".") {
			return "", ErrSyncPath
		}
	}
	cleanRoot := filepath.Clean(root)
	joined := filepath.Clean(filepath.Join(cleanRoot, filepath.FromSlash(slash)))
	rel, err := filepath.Rel(cleanRoot, joined)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", ErrSyncPath
	}
	return joined, nil
}

// ServeConn handles one incoming lanvory-sync/1 session from an authenticated peer.
func ServeConn(ctx context.Context, conn net.Conn, fingerprint string, mgr *Manager, allowed func(fingerprint, folderID string) bool) error {
	if mgr == nil {
		return ErrSyncRejected
	}
	_ = conn.SetDeadline(time.Now().Add(syncFrameTimeout))
	var idLen [1]byte
	if _, err := io.ReadFull(conn, idLen[:]); err != nil {
		return err
	}
	if idLen[0] == 0 || idLen[0] > 64 {
		_, _ = conn.Write([]byte{0})
		return ErrInvalidFolderID
	}
	rawID := make([]byte, int(idLen[0]))
	if _, err := io.ReadFull(conn, rawID); err != nil {
		return err
	}
	folderID := string(rawID)
	if !ValidID(folderID) || (allowed != nil && !allowed(fingerprint, folderID)) {
		_, _ = conn.Write([]byte{0})
		return ErrSyncRejected
	}
	folder, ok := mgr.GetFolder(folderID)
	if !ok || folder.Paused {
		_, _ = conn.Write([]byte{0})
		return ErrSyncRejected
	}
	scanned, err := mgr.Scan(folderID)
	if err != nil {
		_, _ = conn.Write([]byte{0})
		return err
	}
	manifestBytes, err := json.Marshal(remoteManifest{Mode: scanned.Mode, Files: scanned.Files})
	if err != nil || len(manifestBytes) > maxManifestBytes {
		_, _ = conn.Write([]byte{0})
		return errors.New("manifest too large")
	}
	if _, err := conn.Write([]byte{1}); err != nil {
		return err
	}
	if err := writeSizedBytes(conn, manifestBytes); err != nil {
		return err
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_ = conn.SetDeadline(time.Now().Add(syncFrameTimeout))
		var op [1]byte
		if _, err := io.ReadFull(conn, op[:]); err != nil {
			return err
		}
		switch op[0] {
		case opDone:
			return nil
		case opGet:
			relBytes, err := readShortBytes(conn)
			if err != nil {
				return err
			}
			if err := serveGetFile(conn, scanned.Path, string(relBytes)); err != nil {
				return err
			}
		case opPut:
			relBytes, err := readShortBytes(conn)
			if err != nil {
				return err
			}
			if err := servePutFile(conn, mgr, scanned, string(relBytes)); err != nil {
				return err
			}
		default:
			return errors.New("unknown sync operation")
		}
	}
}

func serveGetFile(conn net.Conn, root, relPath string) error {
	target, err := ResolveSafePath(root, relPath)
	if err != nil {
		_, _ = conn.Write([]byte{0})
		return nil
	}
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxFileSize {
		_, _ = conn.Write([]byte{0})
		return nil
	}
	sum, err := hashFile(target)
	if err != nil {
		_, _ = conn.Write([]byte{0})
		return nil
	}
	file, err := os.Open(target)
	if err != nil {
		_, _ = conn.Write([]byte{0})
		return nil
	}
	defer file.Close()

	if _, err := conn.Write([]byte{1}); err != nil {
		return err
	}
	var hdr [8 + 64]byte
	binary.BigEndian.PutUint64(hdr[:8], uint64(info.Size()))
	copy(hdr[8:], sum)
	if _, err := conn.Write(hdr[:]); err != nil {
		return err
	}
	_, err = io.CopyN(conn, file, info.Size())
	return err
}

func servePutFile(conn net.Conn, mgr *Manager, folder Folder, relPath string) error {
	var hdr [8 + 64]byte
	if _, err := io.ReadFull(conn, hdr[:]); err != nil {
		return err
	}
	size := int64(binary.BigEndian.Uint64(hdr[:8]))
	expectedSum := string(hdr[8:])
	if size < 0 || size > MaxFileSize || folder.Mode == ModeSendOnly || folder.Paused {
		_, _ = io.CopyN(io.Discard, conn, max(0, size))
		_, _ = conn.Write([]byte{0})
		return nil
	}
	target, err := ResolveSafePath(folder.Path, relPath)
	if err != nil {
		_, _ = io.CopyN(io.Discard, conn, size)
		_, _ = conn.Write([]byte{0})
		return nil
	}
	if _, _, err := writeVerifiedFile(conn, folder.Path, target, relPath, size, expectedSum, folder.Mode, "peer", mgr, folder.ID); err != nil {
		_, _ = conn.Write([]byte{0})
		return nil
	}
	_, err = conn.Write([]byte{1})
	return err
}

// RunClientSync synchronizes folderID against an authenticated peer connection.
func RunClientSync(ctx context.Context, conn net.Conn, mgr *Manager, folderID, peerLabel string) (SyncResult, error) {
	localFolder, ok := mgr.GetFolder(folderID)
	if !ok {
		return SyncResult{}, ErrFolderNotFound
	}
	if localFolder.Paused {
		return SyncResult{}, errors.New("sync folder is paused locally")
	}
	localScanned, err := mgr.Scan(folderID)
	if err != nil {
		return SyncResult{}, err
	}

	_ = conn.SetDeadline(time.Now().Add(syncFrameTimeout))
	req := append([]byte{byte(len(folderID))}, folderID...)
	if _, err := conn.Write(req); err != nil {
		return SyncResult{}, err
	}
	var allowed [1]byte
	if _, err := io.ReadFull(conn, allowed[:]); err != nil {
		return SyncResult{}, err
	}
	if allowed[0] != 1 {
		return SyncResult{}, ErrSyncRejected
	}
	rawManifest, err := readSizedBytes(conn, maxManifestBytes)
	if err != nil {
		return SyncResult{}, err
	}
	var remote remoteManifest
	if err := json.Unmarshal(rawManifest, &remote); err != nil {
		return SyncResult{}, err
	}

	localByPath := make(map[string]FileEntry, len(localScanned.Files))
	for _, f := range localScanned.Files {
		localByPath[f.RelativePath] = f
	}
	remoteByPath := make(map[string]FileEntry, len(remote.Files))
	for _, f := range remote.Files {
		remoteByPath[f.RelativePath] = f
	}

	var res SyncResult
	res.FolderID = folderID

	// 1. Pull files from peer when local mode allows receiving and remote mode allows sending.
	if (localScanned.Mode == ModeReceiveOnly || localScanned.Mode == ModeBidirectional) &&
		(remote.Mode == ModeSendOnly || remote.Mode == ModeBidirectional) {
		for _, rf := range remote.Files {
			if ctx.Err() != nil {
				return res, ctx.Err()
			}
			lf, exists := localByPath[rf.RelativePath]
			if exists && lf.SHA256 == rf.SHA256 {
				res.Skipped++
				continue
			}
			// In bidirectional mode, if local file is newer than remote, upload it instead of overwriting.
			if exists && localScanned.Mode == ModeBidirectional && lf.ModTime.After(rf.ModTime) {
				continue
			}
			target, err := ResolveSafePath(localScanned.Path, rf.RelativePath)
			if err != nil {
				continue
			}
			_ = conn.SetDeadline(time.Now().Add(syncFrameTimeout))
			if _, err := conn.Write([]byte{opGet}); err != nil {
				return res, err
			}
			if err := writeShortBytes(conn, []byte(rf.RelativePath)); err != nil {
				return res, err
			}
			var status [1]byte
			if _, err := io.ReadFull(conn, status[:]); err != nil {
				return res, err
			}
			if status[0] != 1 {
				continue
			}
			var hdr [8 + 64]byte
			if _, err := io.ReadFull(conn, hdr[:]); err != nil {
				return res, err
			}
			size := int64(binary.BigEndian.Uint64(hdr[:8]))
			sum := string(hdr[8:])
			if size < 0 || size > MaxFileSize {
				return res, errors.New("invalid remote file size")
			}
			conflict, _, err := writeVerifiedFile(conn, localScanned.Path, target, rf.RelativePath, size, sum, localScanned.Mode, peerLabel, mgr, folderID)
			if err != nil {
				return res, err
			}
			if conflict {
				res.Conflicts++
			}
			res.Downloaded++
		}
	}

	// 2. Push local files to peer when local mode allows sending and remote mode allows receiving.
	if (localScanned.Mode == ModeSendOnly || localScanned.Mode == ModeBidirectional) &&
		(remote.Mode == ModeReceiveOnly || remote.Mode == ModeBidirectional) {
		for _, lf := range localScanned.Files {
			if ctx.Err() != nil {
				return res, ctx.Err()
			}
			rf, exists := remoteByPath[lf.RelativePath]
			if exists && rf.SHA256 == lf.SHA256 {
				continue
			}
			if exists && localScanned.Mode == ModeBidirectional && !lf.ModTime.After(rf.ModTime) {
				continue
			}
			srcPath, err := ResolveSafePath(localScanned.Path, lf.RelativePath)
			if err != nil {
				continue
			}
			file, err := os.Open(srcPath)
			if err != nil {
				continue
			}
			_ = conn.SetDeadline(time.Now().Add(syncFrameTimeout))
			if _, err := conn.Write([]byte{opPut}); err != nil {
				file.Close()
				return res, err
			}
			if err := writeShortBytes(conn, []byte(lf.RelativePath)); err != nil {
				file.Close()
				return res, err
			}
			var hdr [8 + 64]byte
			binary.BigEndian.PutUint64(hdr[:8], uint64(lf.Size))
			copy(hdr[8:], lf.SHA256)
			if _, err := conn.Write(hdr[:]); err != nil {
				file.Close()
				return res, err
			}
			_, copyErr := io.CopyN(conn, file, lf.Size)
			file.Close()
			if copyErr != nil {
				return res, copyErr
			}
			var ack [1]byte
			if _, err := io.ReadFull(conn, ack[:]); err != nil {
				return res, err
			}
			if ack[0] == 1 {
				res.Uploaded++
			}
		}
	}

	_, _ = conn.Write([]byte{opDone})
	updated, err := mgr.Scan(folderID)
	if err == nil {
		res.Folder = updated
	} else {
		res.Folder = localScanned
	}
	return res, nil
}

func writeVerifiedFile(src io.Reader, root, target, relPath string, size int64, expectedSum string, mode Mode, peerLabel string, mgr *Manager, folderID string) (bool, string, error) {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		_, _ = io.CopyN(io.Discard, src, size)
		return false, "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(target), ".lanvory-sync-*")
	if err != nil {
		_, _ = io.CopyN(io.Discard, src, size)
		return false, "", err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		tmp.Close()
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	if _, err := io.CopyN(io.MultiWriter(tmp, hasher), src, size); err != nil {
		return false, "", err
	}
	if hex.EncodeToString(hasher.Sum(nil)) != expectedSum {
		return false, "", errors.New("checksum mismatch")
	}
	if err := tmp.Close(); err != nil {
		return false, "", err
	}

	conflictCreated := false
	var conflictCopy string
	if info, statErr := os.Lstat(target); statErr == nil && info.Mode().IsRegular() && mode == ModeBidirectional {
		if existingSum, err := hashFile(target); err == nil && existingSum != expectedSum {
			conflictRel := ConflictFilename(relPath, peerLabel, time.Now())
			if conflictPath, err := ResolveSafePath(root, conflictRel); err == nil {
				if err := os.Rename(target, conflictPath); err == nil {
					conflictCreated = true
					conflictCopy = conflictRel
					mgr.RecordConflict(folderID, Conflict{
						RelativePath: relPath,
						ConflictCopy: conflictRel,
						DetectedAt:   time.Now().UTC(),
					})
				}
			}
		}
	}

	if err := os.Rename(tmpPath, target); err != nil {
		return false, "", err
	}
	cleanup = false
	return conflictCreated, conflictCopy, nil
}

func writeSizedBytes(w io.Writer, data []byte) error {
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(data)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return err
	}
	_, err := w.Write(data)
	return err
}

func readSizedBytes(r io.Reader, limit int) ([]byte, error) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return nil, err
	}
	n := int(binary.BigEndian.Uint32(lenBuf[:]))
	if n < 0 || n > limit {
		return nil, fmt.Errorf("frame too large: %d", n)
	}
	buf := make([]byte, n)
	_, err := io.ReadFull(r, buf)
	return buf, err
}

func writeShortBytes(w io.Writer, data []byte) error {
	var lenBuf [2]byte
	binary.BigEndian.PutUint16(lenBuf[:], uint16(len(data)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return err
	}
	_, err := w.Write(data)
	return err
}

func readShortBytes(r io.Reader) ([]byte, error) {
	var lenBuf [2]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return nil, err
	}
	n := int(binary.BigEndian.Uint16(lenBuf[:]))
	if n == 0 || n > 4096 {
		return nil, ErrSyncPath
	}
	buf := make([]byte, n)
	_, err := io.ReadFull(r, buf)
	return buf, err
}

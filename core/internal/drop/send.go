//go:build darwin || linux

package drop

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

var ErrNotAccepted = errors.New("peer did not accept or confirm this file")

type Source struct {
	file     *os.File
	Manifest Manifest
}

func OpenSource(ctx context.Context, path string) (*Source, error) {
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	source, err := prepareSource(ctx, file, filepath.Base(path))
	if err != nil {
		file.Close()
	}
	return source, err
}

func prepareSource(ctx context.Context, file *os.File, name string) (*Source, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxFileSize {
		return nil, errors.New("select one regular file of at most 1 GiB")
	}
	manifest := Manifest{Name: name, Size: info.Size()}
	digest := sha256.New()
	data := make([]byte, 64*1024)
	for remaining := info.Size(); remaining > 0; {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		length := min(int64(len(data)), remaining)
		if _, err := io.ReadFull(file, data[:length]); err != nil {
			return nil, err
		}
		if _, err := digest.Write(data[:length]); err != nil {
			return nil, err
		}
		remaining -= length
	}
	manifest.SHA256 = hex.EncodeToString(digest.Sum(nil))
	if err := ValidateManifest(manifest); err != nil {
		return nil, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return &Source{file: file, Manifest: manifest}, nil
}

func (s *Source) Close() error { return s.file.Close() }

func (s *Source) SendStream(ctx context.Context, conn net.Conn) error {
	return s.SendTracked(ctx, conn, nil)
}

func (s *Source) SendTracked(ctx context.Context, conn net.Conn, progress *Progress) error {
	ctx, cancel := context.WithTimeout(ctx, transferTimeout)
	defer cancel()
	until, _ := ctx.Deadline()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	payload, err := json.Marshal(s.Manifest)
	if err != nil {
		return err
	}
	if err := conn.SetWriteDeadline(minDeadline(time.Now().Add(idleTimeout), until)); err != nil {
		return err
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := conn.Write(header[:]); err != nil {
		return err
	}
	if _, err := conn.Write(payload); err != nil {
		return err
	}
	if err := readMark(conn, until, approvalWindow+idleTimeout, readyByte); err != nil {
		return err
	}

	progress.Update(0)
	data := make([]byte, 64*1024)
	for remaining := s.Manifest.Size; remaining > 0; {
		if err := ctx.Err(); err != nil {
			return err
		}
		length := min(int64(len(data)), remaining)
		if _, err := io.ReadFull(s.file, data[:length]); err != nil {
			return err
		}
		if err := conn.SetWriteDeadline(minDeadline(time.Now().Add(idleTimeout), until)); err != nil {
			return err
		}
		if _, err := conn.Write(data[:length]); err != nil {
			return err
		}
		remaining -= length
		progress.Update(s.Manifest.Size - remaining)
	}
	return readMark(conn, until, 15*time.Second, savedByte)
}

func readMark(conn net.Conn, until time.Time, timeout time.Duration, expected byte) error {
	if err := conn.SetReadDeadline(minDeadline(time.Now().Add(timeout), until)); err != nil {
		return err
	}
	var marker [1]byte
	if _, err := io.ReadFull(conn, marker[:]); err != nil || marker[0] != expected {
		return ErrNotAccepted
	}
	return nil
}

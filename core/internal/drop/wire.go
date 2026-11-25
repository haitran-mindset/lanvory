package drop

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"time"
)

const Protocol = "lanvory-drop/1"
const readyByte = 1
const savedByte = 2
const maxManifestBytes = 4096
const idleTimeout = 5 * time.Second
const transferTimeout = 3 * time.Minute

func readManifest(stream io.Reader) (Manifest, error) {
	var header [4]byte
	if _, err := io.ReadFull(stream, header[:]); err != nil {
		return Manifest{}, err
	}
	length := binary.BigEndian.Uint32(header[:])
	if length == 0 || length > maxManifestBytes {
		return Manifest{}, errors.New("invalid file offer length")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(stream, payload); err != nil {
		return Manifest{}, err
	}
	var offer Manifest
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&offer); err != nil {
		return Manifest{}, err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return Manifest{}, errors.New("unexpected data in file offer")
	}
	return offer, ValidateManifest(offer)
}

type deadlineReader struct {
	conn  net.Conn
	until time.Time
}

func (r deadlineReader) Read(data []byte) (int, error) {
	if err := r.conn.SetReadDeadline(minDeadline(time.Now().Add(idleTimeout), r.until)); err != nil {
		return 0, err
	}
	return r.conn.Read(data)
}

func minDeadline(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (r *Receiver) ReceiveStream(ctx context.Context, conn net.Conn, fingerprint string, scope func() bool) error {
	ctx, cancel := context.WithTimeout(ctx, transferTimeout)
	defer cancel()
	until, _ := ctx.Deadline()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	reader := deadlineReader{conn: conn, until: until}
	offer, err := readManifest(reader)
	if err != nil {
		return err
	}
	err = r.receive(ctx, fingerprint, offer, func() (io.Reader, error) {
		if err := writeMark(conn, until, readyByte); err != nil {
			return nil, err
		}
		return reader, nil
	}, scope)
	if err != nil {
		return err
	}
	return writeMark(conn, until, savedByte)
}

func writeMark(conn net.Conn, until time.Time, marker byte) error {
	if err := conn.SetWriteDeadline(minDeadline(time.Now().Add(idleTimeout), until)); err != nil {
		return err
	}
	_, err := conn.Write([]byte{marker})
	return err
}

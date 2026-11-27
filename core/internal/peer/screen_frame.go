package peer

import (
	"encoding/binary"
	"encoding/hex"
	"io"

	"lanvory.local/core/internal/screenshare"
)

const (
	screenFrameMarker     byte = 0x01
	screenFrameHeaderSize      = 1 + 16 + 8 + 4
)

func writeScreenFrame(w io.Writer, request screenshare.Request) error {
	var header [screenFrameHeaderSize]byte
	header[0] = screenFrameMarker
	if len(request.ID) != 32 || len(request.Frame) == 0 || len(request.Frame) > screenshare.MaxUHDFrame || request.Sequence == 0 {
		return screenshare.ErrUnavailable
	}
	if _, err := hex.Decode(header[1:17], []byte(request.ID)); err != nil {
		return screenshare.ErrUnavailable
	}
	binary.BigEndian.PutUint64(header[17:25], request.Sequence)
	binary.BigEndian.PutUint32(header[25:29], uint32(len(request.Frame)))
	// Write one TLS application payload for small frames without copying large frames.
	if len(request.Frame) <= 4*1024 {
		_, err := w.Write(append(header[:], request.Frame...))
		return err
	}
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	_, err := w.Write(request.Frame)
	return err
}

func readScreenFrame(r io.Reader) (screenshare.Request, error) {
	var header [screenFrameHeaderSize]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return screenshare.Request{}, err
	}
	size := binary.BigEndian.Uint32(header[25:29])
	sequence := binary.BigEndian.Uint64(header[17:25])
	if header[0] != screenFrameMarker || size == 0 || size > screenshare.MaxUHDFrame || sequence == 0 {
		return screenshare.Request{}, screenshare.ErrUnavailable
	}
	frame := make([]byte, size)
	if _, err := io.ReadFull(r, frame); err != nil {
		return screenshare.Request{}, err
	}
	return screenshare.Request{
		Action: "frame", ID: hex.EncodeToString(header[1:17]), Sequence: sequence, Frame: frame, Stream: true, Binary: true,
	}, nil
}

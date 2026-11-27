package peer

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"lanvory.local/core/internal/screenshare"
)

func TestBinaryScreenFrameRoundTrip(t *testing.T) {
	request := screenshare.Request{
		Action: "frame", ID: strings.Repeat("ab", 16), Sequence: 17,
		Frame: bytes.Repeat([]byte{0xff, 0x00, 0xd9}, 64*1024), Stream: true, Binary: true,
	}
	var encoded bytes.Buffer
	if err := writeScreenFrame(&encoded, request); err != nil {
		t.Fatal(err)
	}
	legacy, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if encoded.Len() != len(request.Frame)+screenFrameHeaderSize || encoded.Len()*100 > len(legacy)*76 {
		t.Fatalf("binary size %d, JSON size %d", encoded.Len(), len(legacy))
	}
	got, err := readScreenFrame(&encoded)
	if err != nil || got.ID != request.ID || got.Sequence != request.Sequence || !got.Binary || !bytes.Equal(got.Frame, request.Frame) {
		t.Fatal("binary screen frame did not round trip")
	}
}

func TestBinaryScreenFrameRejectsOversizeAndTruncatedPayload(t *testing.T) {
	var header [screenFrameHeaderSize]byte
	header[0] = screenFrameMarker
	binary.BigEndian.PutUint64(header[17:25], 1)
	binary.BigEndian.PutUint32(header[25:29], screenshare.MaxUHDFrame+1)
	if _, err := readScreenFrame(bytes.NewReader(header[:])); !errors.Is(err, screenshare.ErrUnavailable) {
		t.Fatalf("oversize frame: %v", err)
	}
	binary.BigEndian.PutUint32(header[25:29], 2)
	if _, err := readScreenFrame(bytes.NewReader(append(header[:], 0xff))); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("truncated frame: %v", err)
	}
}

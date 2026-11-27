package screenshare

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"strings"
	"testing"
	"time"
)

func TestInvitationLifecycle(t *testing.T) {
	m := New()
	now := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return now }
	offer := Request{Action: "offer", ID: strings.Repeat("01", 16), Offer: "video offer", CreatedAt: now}
	status := Request{Action: "status", ID: offer.ID}
	if reply, err := m.Handle("sender", offer); err != nil || reply.State != "pending" {
		t.Fatalf("offer: %+v %v", reply, err)
	}
	if replay, err := m.Handle("sender", offer); err != nil || replay.State != "pending" || len(m.Pending()) != 1 {
		t.Fatalf("retry created a duplicate: %+v %v", replay, err)
	}
	for _, action := range []string{"offer", "status", "stop"} {
		spoof := status
		spoof.Action = action
		if _, err := m.Handle("different sender", spoof); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("unexpected result for mismatched peer: %v", err)
		}
	}
	if err := m.Decide(offer.ID, true, "video answer"); err != nil {
		t.Fatal(err)
	}
	if len(m.Pending()) != 0 {
		t.Fatal("accepted invitation remained pending")
	}
	if reply, err := m.Handle("sender", status); err != nil || reply.State != "accepted" || reply.Answer != "video answer" {
		t.Fatalf("status: %+v %v", reply, err)
	}
	if err := m.Stop(offer.ID); err != nil {
		t.Fatal(err)
	}
	if reply, err := m.Handle("sender", status); err != nil || reply.State != "stopped" || reply.Answer != "" {
		t.Fatalf("stop: %+v %v", reply, err)
	}
	now = now.Add(time.Minute)
	if _, err := m.Handle("sender", offer); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expired offer was replayed: %v", err)
	}
}

func TestInvitationExpiresAndValidatesInput(t *testing.T) {
	m := New()
	now := time.Now()
	m.now = func() time.Time { return now }
	offer := Request{Action: "offer", ID: strings.Repeat("02", 16), Offer: "sdp", CreatedAt: now}
	bad := offer
	bad.Offer = strings.Repeat("x", MaxDescription+1)
	if _, err := m.Handle("sender", bad); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("oversized offer was accepted: %v", err)
	}
	if _, err := m.Handle("sender", offer); err != nil {
		t.Fatal(err)
	}
	now = now.Add(inviteLifetime)
	if err := m.Decide(offer.ID, true, "answer"); !errors.Is(err, ErrUnavailable) || len(m.Pending()) != 0 {
		t.Fatalf("expired invitation was accepted: %v", err)
	}
}

func TestScreenFramesRequireConsentAndStopOnRevocation(t *testing.T) {
	m := New()
	now := time.Now()
	m.now = func() time.Time { return now }
	var data bytes.Buffer
	if err := jpeg.Encode(&data, image.NewRGBA(image.Rect(0, 0, 16, 16)), nil); err != nil {
		t.Fatal(err)
	}
	id := strings.Repeat("03", 16)
	offer := Request{Action: "offer", ID: id, Offer: JPEGFormat, CreatedAt: now}
	frame := Request{Action: "frame", ID: id, Frame: data.Bytes(), Sequence: 1}
	trusted := func(peer string) bool { return peer == "sender" }
	if _, err := m.Handle("sender", offer); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Handle("sender", frame); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("frame accepted before local consent: %v", err)
	}
	if err := m.Decide(id, true, JPEGFormat); err != nil {
		t.Fatal(err)
	}
	bad := frame
	bad.Frame = []byte("not a picture")
	if _, err := m.Handle("sender", bad); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("invalid JPEG was accepted: %v", err)
	}
	if _, err := m.Handle("sender", frame); err != nil {
		t.Fatal(err)
	}
	if got := m.View(id, 0, trusted); got.Sequence != 1 || !bytes.Equal(got.Frame, frame.Frame) {
		t.Fatalf("view returned wrong frame: %+v", got)
	}
	if got := m.View(id, 1, trusted); len(got.Frame) != 0 {
		t.Fatal("previous frame delivered twice")
	}
	if _, err := m.Handle("sender", frame); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("out-of-order frame was accepted: %v", err)
	}
	if got := m.View(id, 0, func(string) bool { return false }); got.State != "stopped" || len(got.Frame) != 0 {
		t.Fatal("revoked sender still visible")
	}
	now = now.Add(4 * time.Second)
	if got := m.View(id, 0, trusted); len(got.Frame) != 0 {
		t.Fatal("stale frame was returned")
	}
	if err := m.Stop(id); err != nil {
		t.Fatal(err)
	}
	frame.Sequence++
	if _, err := m.Handle("sender", frame); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("frame accepted after stop: %v", err)
	}
	if got := m.View(id, 0, trusted); got.State != "stopped" || len(got.Frame) != 0 {
		t.Fatal("stopped session still visible")
	}
}

func TestStalledScreenSessionReleasesInviteSlot(t *testing.T) {
	m := New()
	now := time.Now()
	m.now = func() time.Time { return now }
	offer := Request{Action: "offer", ID: strings.Repeat("04", 16), Offer: JPEGFormat, CreatedAt: now}
	if _, err := m.Handle("sender", offer); err != nil {
		t.Fatal(err)
	}
	if err := m.Decide(offer.ID, true, JPEGFormat); err != nil {
		t.Fatal(err)
	}
	now = now.Add(frameTimeout)
	if reply, err := m.Handle("sender", offer); err != nil || reply.State != "stopped" {
		t.Fatalf("stalled session should stop without replaying the invitation: %+v %v", reply, err)
	}
	offer.ID, offer.CreatedAt = strings.Repeat("05", 16), now
	if reply, err := m.Handle("next sender", offer); err != nil || reply.State != "pending" {
		t.Fatalf("stalled session blocked a new invitation: %+v %v", reply, err)
	}
}

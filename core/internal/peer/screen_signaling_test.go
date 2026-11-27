package peer

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"image"
	"image/jpeg"
	"net"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/screenshare"
)

func TestScreenSignalingAuthenticatesAndChecksScope(t *testing.T) {
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	senderPublic, senderKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	sender := Fingerprint(sha256.Sum256(senderPublic)).String()
	var trusted, approved atomic.Bool
	listener := &Listener{
		name: "en0", index: 1, source: netip.MustParseAddr("192.168.50.2"), config: config,
		trusted: func(pin string) (bool, error) { return trusted.Load() && pin == sender, nil },
		inventory: func() ([]networking.Interface, error) {
			return []networking.Interface{{
				Name: "en0", Index: 1, Up: true, Eligible: true, Approved: approved.Load(),
				Addresses: []string{"192.168.50.2/24"},
			}}, nil
		},
	}
	manager := screenshare.New()
	listener.EnableScreenSignaling(manager)
	clientConfig, err := clientIdentity(sha256.Sum256(serverPublic), senderKey, screenshare.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	exchange := func(remote string, request screenshare.Request) (screenshare.Reply, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		server, client := net.Pipe()
		defer client.Close()
		limit, _ := ctx.Deadline()
		_ = server.SetDeadline(limit)
		_ = client.SetDeadline(limit)
		go func() {
			defer server.Close()
			conn := tls.Server(server, listener.config)
			if conn.HandshakeContext(ctx) == nil {
				listener.receiveScreenSignal(conn, netip.MustParseAddr(remote))
			}
		}()
		conn := tls.Client(client, clientConfig)
		var reply screenshare.Reply
		if err := conn.HandshakeContext(ctx); err != nil {
			return reply, err
		}
		if err := json.NewEncoder(conn).Encode(request); err != nil {
			return reply, err
		}
		err := json.NewDecoder(conn).Decode(&reply)
		return reply, err
	}
	offer := screenshare.Request{Action: "offer", ID: strings.Repeat("01", 16), Offer: screenshare.JPEGFormat, CreatedAt: time.Now()}
	approved.Store(true)
	if _, err := exchange("192.168.50.3", offer); err == nil || len(manager.Pending()) != 0 {
		t.Fatal("an untrusted sender could invite")
	}
	trusted.Store(true)
	if _, err := exchange("192.168.60.3", offer); err == nil || len(manager.Pending()) != 0 {
		t.Fatal("an out-of-scope sender could invite")
	}
	if reply, err := exchange("192.168.50.3", offer); err != nil || reply.State != "pending" {
		t.Fatalf("trusted sender could not invite: %+v %v", reply, err)
	}
	if err := manager.Decide(offer.ID, true, screenshare.JPEGFormat); err != nil {
		t.Fatal(err)
	}
	status := screenshare.Request{Action: "status", ID: offer.ID}
	if reply, err := exchange("192.168.50.3", status); err != nil || reply.Answer != screenshare.JPEGFormat {
		t.Fatalf("could not retrieve approved answer: %+v %v", reply, err)
	}
	var data bytes.Buffer
	if err := jpeg.Encode(&data, image.NewRGBA(image.Rect(0, 0, 16, 16)), nil); err != nil {
		t.Fatal(err)
	}
	frame := screenshare.Request{Action: "frame", ID: offer.ID, Frame: data.Bytes(), Sequence: 1}
	if _, err := exchange("192.168.50.3", frame); err != nil {
		t.Fatal(err)
	}
	if got := manager.View(offer.ID, 0, func(string) bool { return true }); !bytes.Equal(got.Frame, frame.Frame) {
		t.Fatal("received frame was not made available to the viewer")
	}
	approved.Store(false)
	if _, err := exchange("192.168.50.3", status); err == nil {
		t.Fatal("adapter revocation did not stop signaling")
	}
}

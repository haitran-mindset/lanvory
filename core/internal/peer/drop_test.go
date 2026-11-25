//go:build darwin || linux

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lanvory.local/core/internal/drop"
)

func TestMutualDropStreamsOnlyAfterExplicitApproval(t *testing.T) {
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	clientFingerprint := Fingerprint(sha256.Sum256(clientPublic))
	trust := func(pin string) (bool, error) { return pin == clientFingerprint.String(), nil }
	receiverDir := t.TempDir()
	receiver := drop.NewReceiver(receiverDir, trust, nil)
	senderPath := filepath.Join(t.TempDir(), "sample.txt")
	if err := os.WriteFile(senderPath, []byte("sample contents"), 0600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	source, err := drop.OpenSource(ctx, senderPath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()

	serverRaw, clientRaw := net.Pipe()
	defer serverRaw.Close()
	defer clientRaw.Close()
	server := tls.Server(serverRaw, mutualServer(identity, trust, true, false))
	config, err := clientIdentity(sha256.Sum256(serverPublic), clientKey, drop.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	client := tls.Client(clientRaw, config)
	received := make(chan error, 1)
	go func() {
		if err := server.HandshakeContext(ctx); err != nil {
			received <- err
			return
		}
		fingerprint, err := certificateFingerprint(server.ConnectionState(), drop.Protocol)
		if err != nil {
			received <- err
			return
		}
		received <- receiver.ReceiveStream(ctx, server, fingerprint.String(), nil)
	}()
	if err := client.HandshakeContext(ctx); err != nil {
		t.Fatal(err)
	}
	sent := make(chan error, 1)
	go func() { sent <- source.SendStream(ctx, client) }()

	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	approved := false
	for !approved {
		select {
		case err := <-sent:
			t.Fatalf("sender completed before approval: %v", err)
		case <-ctx.Done():
			t.Fatal("timed out waiting for the offer")
		case <-tick.C:
			if offers := receiver.Pending(); len(offers) == 1 {
				if offers[0].Fingerprint != clientFingerprint.String() || offers[0].Manifest != source.Manifest {
					t.Fatal("offer lost authenticated peer identity or manifest")
				}
				if _, err := os.Stat(filepath.Join(receiverDir, drop.Inbox)); !os.IsNotExist(err) {
					t.Fatalf("inbox accessed before approval: %v", err)
				}
				if err := receiver.Decide(offers[0].ID, true); err != nil {
					t.Fatal(err)
				}
				approved = true
			}
		}
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
	if err := <-received; err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(filepath.Join(receiverDir, drop.Inbox, "sample.txt"))
	if err != nil || string(contents) != "sample contents" {
		t.Fatalf("received=%q,%v", contents, err)
	}
	activity := receiver.Tracker().Snapshot()
	if len(activity.Transfers) != 1 || activity.Transfers[0].State != drop.Completed || activity.Transfers[0].Bytes != int64(len(contents)) {
		t.Fatalf("inbox history = %+v", activity)
	}

}

package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"lanvory.local/core/internal/pairing"
)

func TestPairingUsesSameTLSCodeAndRequiresBothApprovals(t *testing.T) {
	serverPublic, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientPublic, clientKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serverPin, clientPin := Fingerprint(sha256.Sum256(serverPublic)), Fingerprint(sha256.Sum256(clientPublic))
	identity, err := identityTLS(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := enablePairingTLS(identity)
	clientConfig, err := clientIdentity(serverPin, clientKey, pairing.Protocol)
	if err != nil {
		t.Fatal(err)
	}
	var previous string
	for _, outcome := range []string{"decline", "cancel", "approve"} {
		consent := outcome == "approve"
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		clientCtx, cancelClient := context.WithCancel(ctx)
		defer cancelClient()
		serverRaw, clientRaw := net.Pipe()
		defer serverRaw.Close()
		defer clientRaw.Close()
		server, client := tls.Server(serverRaw, serverConfig), tls.Client(clientRaw, clientConfig)
		var serverSaved, clientSaved atomic.Bool
		serverPair := pairing.New(func(pin string) error { serverSaved.Store(pin == clientPin.String()); return nil })
		clientPair := pairing.New(func(pin string) error { clientSaved.Store(pin == serverPin.String()); return nil })
		result := make(chan error, 2)
		go func() {
			defer serverRaw.Close()
			if err := server.HandshakeContext(ctx); err != nil {
				result <- err
				return
			}
			result <- ExchangePairing(ctx, server, serverPair, "incoming", func() bool { return true })
		}()
		go func() {
			defer clientRaw.Close()
			if err := client.HandshakeContext(clientCtx); err != nil {
				result <- err
				return
			}
			result <- ExchangePairing(clientCtx, client, clientPair, "outgoing", func() bool { return true })
		}()
		incoming, outgoing := waitPair(t, ctx, serverPair), waitPair(t, ctx, clientPair)
		if incoming.Direction != "incoming" || outgoing.Direction != "outgoing" ||
			incoming.Code != outgoing.Code || incoming.Code == previous ||
			incoming.Fingerprint != clientPin.String() || outgoing.Fingerprint != serverPin.String() {
			t.Fatal("pairing did not bind the endpoints and a fresh verification code")
		}
		previous = incoming.Code
		if err := clientPair.Decide(outgoing.ID, incoming.Code, true); err != nil {
			t.Fatal(err)
		}
		// The initiator's consent alone must not save either key.
		select {
		case err := <-result:
			t.Fatalf("pairing finished without receiver consent: %v", err)
		case <-time.After(40 * time.Millisecond):
		}
		if serverSaved.Load() || clientSaved.Load() {
			t.Fatal("saved trust before both approvals")
		}
		if outcome == "cancel" {
			cancelClient()
		} else if err := serverPair.Decide(incoming.ID, outgoing.Code, consent); err != nil {
			t.Fatal(err)
		}
		for range 2 {
			select {
			case err := <-result:
				if (err == nil) != consent {
					t.Fatalf("%s: pairing result = %v", outcome, err)
				}
			case <-ctx.Done():
				t.Fatalf("%s: pairing did not terminate before the session deadline", outcome)
			}
		}
		if len(serverPair.List()) != 0 || len(clientPair.List()) != 0 {
			t.Fatalf("%s: pairing left a pending request", outcome)
		}
		if serverSaved.Load() != consent || clientSaved.Load() != consent {
			t.Fatal("unexpected trust persistence")
		}
		if err := serverPair.Decide(incoming.ID, outgoing.Code, true); err == nil {
			t.Fatal("approved a consumed pairing ID")
		}
		cancel()
	}
}

func waitPair(t *testing.T, ctx context.Context, manager *pairing.Manager) pairing.Request {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		if rows := manager.List(); len(rows) == 1 {
			return rows[0]
		}
		select {
		case <-ctx.Done():
			t.Fatal("pairing never reached the consent queue")
		case <-ticker.C:
		}
	}
}

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
)

func TestMutualVerificationRequiresRemoteTrust(t *testing.T) {
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
	clientPin := Fingerprint(sha256.Sum256(clientPublic)).String()
	var allowed atomic.Bool
	trusted := func(pin string) (bool, error) { return allowed.Load() && pin == clientPin, nil }
	serverConfig := mutualServer(identity, trusted, false, false)
	clientConfig, err := mutualClient(sha256.Sum256(serverPublic), clientKey)
	if err != nil {
		t.Fatal(err)
	}

	for _, approve := range []bool{false, true, false} {
		allowed.Store(approve)
		serverTransport, clientTransport := net.Pipe()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		deadline, _ := ctx.Deadline()
		if err := clientTransport.SetDeadline(deadline); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() {
			defer serverTransport.Close()
			server := tls.Server(serverTransport, serverConfig)
			err := server.HandshakeContext(ctx)
			if err == nil {
				err = acknowledgeMutual(server, trusted)
			}
			done <- err
		}()
		client := tls.Client(clientTransport, clientConfig)
		clientErr := client.HandshakeContext(ctx)
		if clientErr == nil {
			clientErr = finishMutualHandshake(client)
		}
		clientTransport.Close()
		serverErr := <-done
		cancel()
		if (clientErr == nil) != approve || (serverErr == nil) != approve {
			t.Fatalf("approval=%t: client=%v server=%v", approve, clientErr, serverErr)
		}
	}
}

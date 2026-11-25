package peer

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"errors"
	"io"
	"slices"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/drop"
)

const trustedProtocol = "lanvory-trusted/1"
const accepted = 1

func certificateFingerprint(state tls.ConnectionState, protocol string) (Fingerprint, error) {
	if state.NegotiatedProtocol != protocol || len(state.PeerCertificates) != 1 {
		return Fingerprint{}, ErrPeerIdentity
	}
	cert := state.PeerCertificates[0]
	key, ok := cert.PublicKey.(ed25519.PublicKey)
	now := time.Now()
	if !ok || now.Before(cert.NotBefore) || now.After(cert.NotAfter) {
		return Fingerprint{}, ErrPeerIdentity
	}
	return sha256.Sum256(key), nil
}

func mutualServer(identity *tls.Config, trusted func(string) (bool, error), receiveFiles, shareServices bool) *tls.Config {
	if trusted == nil {
		return identity
	}
	primary := identity.Clone()
	configForProtocol := func(alpn string) *tls.Config { return trustedTLS(identity, alpn, trusted) }
	mutual := configForProtocol(trustedProtocol)
	var file *tls.Config
	if receiveFiles {
		file = configForProtocol(drop.Protocol)
	}
	var service *tls.Config
	if shareServices {
		service = configForProtocol(bridge.Protocol)
	}
	primary.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if service != nil && slices.Contains(hello.SupportedProtos, bridge.Protocol) {
			return service, nil
		}
		if file != nil && slices.Contains(hello.SupportedProtos, drop.Protocol) {
			return file, nil
		}
		if slices.Contains(hello.SupportedProtos, trustedProtocol) {
			return mutual, nil
		}
		return nil, nil
	}
	return primary
}

func trustedTLS(identity *tls.Config, alpn string, trusted func(string) (bool, error)) *tls.Config {
	return trustedProtocolsTLS(identity, []string{alpn}, trusted)
}

func trustedProtocolsTLS(identity *tls.Config, protocols []string, trusted func(string) (bool, error)) *tls.Config {
	config := identity.Clone()
	config.NextProtos = protocols
	// Verify the live Ed25519 key against the trust store instead of a CA.
	config.ClientAuth = tls.RequireAnyClientCert
	config.VerifyConnection = func(state tls.ConnectionState) error {
		if !slices.Contains(protocols, state.NegotiatedProtocol) {
			return ErrPeerIdentity
		}
		fingerprint, err := certificateFingerprint(state, state.NegotiatedProtocol)
		if err != nil {
			return err
		}
		ok, err := trusted(fingerprint.String())
		if err != nil || !ok {
			return ErrPeerIdentity
		}
		return nil
	}
	return config
}

func mutualClient(expected Fingerprint, key ed25519.PrivateKey) (*tls.Config, error) {
	return clientIdentity(expected, key, trustedProtocol)
}

func clientIdentity(expected Fingerprint, key ed25519.PrivateKey, protocol string) (*tls.Config, error) {
	identity, err := identityTLS(key)
	if err != nil {
		return nil, err
	}
	config := pinnedTLS(expected, protocol)
	config.Certificates = identity.Certificates
	return config, nil
}

func acknowledgeMutual(conn *tls.Conn, trusted func(string) (bool, error)) error {
	if trusted == nil {
		return ErrPeerIdentity
	}
	pin, err := certificateFingerprint(conn.ConnectionState(), trustedProtocol)
	if err != nil {
		return err
	}
	ok, err := trusted(pin.String())
	if err != nil || !ok {
		return ErrPeerIdentity
	}
	_, err = conn.Write([]byte{accepted})
	return err
}

func finishMutualHandshake(conn *tls.Conn) error {
	var ack [1]byte
	if _, err := io.ReadFull(conn, ack[:]); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return ErrPeerIdentity
		}
		return err
	}
	if ack[0] != accepted {
		return ErrPeerIdentity
	}
	return nil
}

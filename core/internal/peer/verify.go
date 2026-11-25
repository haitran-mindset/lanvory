package peer

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"time"

	"lanvory.local/core/internal/networking"
)

var ErrPeerScope = errors.New("peer endpoint is outside the approved interface scope")
var ErrPeerIdentity = errors.New("peer TLS identity verification failed")

type Fingerprint [sha256.Size]byte

func (fingerprint Fingerprint) String() string {
	return hex.EncodeToString(fingerprint[:])
}

func ParseFingerprint(input string) (Fingerprint, error) {
	var result Fingerprint
	if len(input) != hex.EncodedLen(len(result)) {
		return result, errors.New("expected a 64-digit hexadecimal Ed25519 fingerprint")
	}
	if _, err := hex.Decode(result[:], []byte(input)); err != nil {
		return Fingerprint{}, errors.New("expected a 64-digit hexadecimal Ed25519 fingerprint")
	}
	return result, nil
}

func pinnedTLS(expected Fingerprint, alpn string) *tls.Config {
	return &tls.Config{
		MinVersion:             tls.VersionTLS13,
		NextProtos:             []string{alpn},
		SessionTicketsDisabled: true,
		// The self-signed certificate is authenticated by the required key pin.
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			actual, err := certificateFingerprint(state, alpn)
			if err != nil || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
				return ErrPeerIdentity
			}
			return nil
		},
	}
}

func endpointScope(interfaces []networking.Interface, adapter string, endpoint netip.AddrPort) (netip.Addr, int) {
	if endpoint.Port() == 0 {
		return netip.Addr{}, 0
	}
	decision := networking.CheckScope(interfaces, adapter, endpoint.Addr())
	if !decision.Allowed {
		return netip.Addr{}, 0
	}
	source, err := netip.ParseAddr(decision.Source)
	if err != nil {
		return netip.Addr{}, 0
	}
	return source, networking.ListenerIndex(interfaces, adapter, source)
}

// Verify closes the connection after authentication, without sending application data.
func Verify(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	inventory func() ([]networking.Interface, error)) error {
	return verify(ctx, adapter, endpoint, inventory, pinnedTLS(expected, protocol), false)
}

func VerifyMutual(ctx context.Context, adapter string, endpoint netip.AddrPort, expected Fingerprint,
	inventory func() ([]networking.Interface, error), key ed25519.PrivateKey) error {
	if err := VerifyQUIC(ctx, adapter, endpoint, expected, inventory, key); !errors.Is(err, ErrQUICUnreachable) {
		return err
	}
	config, err := mutualClient(expected, key)
	if err != nil {
		return err
	}
	return verify(ctx, adapter, endpoint, inventory, config, true)
}

func verify(ctx context.Context, adapter string, endpoint netip.AddrPort, inventory func() ([]networking.Interface, error),
	config *tls.Config, mutual bool) error {
	conn, err := dialScoped(ctx, adapter, endpoint, inventory, config)
	if err != nil {
		return err
	}
	defer conn.Close()
	if mutual {
		limit := time.Now().Add(2 * time.Second)
		if deadline, ok := ctx.Deadline(); ok && deadline.Before(limit) {
			limit = deadline
		}
		if err := conn.SetReadDeadline(limit); err != nil {
			return err
		}
		if err := finishMutualHandshake(conn); err != nil {
			return err
		}
	}
	return nil
}

func dialScoped(ctx context.Context, adapter string, endpoint netip.AddrPort,
	inventory func() ([]networking.Interface, error), config *tls.Config) (*tls.Conn, error) {
	interfaces, err := inventory()
	if err != nil {
		return nil, err
	}
	source, index := endpointScope(interfaces, adapter, endpoint)
	if index == 0 {
		return nil, ErrPeerScope
	}

	deadline, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	dialer := tls.Dialer{
		Config: config,
		NetDialer: &net.Dialer{
			LocalAddr: net.TCPAddrFromAddrPort(netip.AddrPortFrom(source, 0)),
			Control:   bindInterface(index),
		},
	}
	conn, err := dialer.DialContext(deadline, "tcp4", endpoint.String())
	if err != nil {
		return nil, err
	}
	interfaces, err = inventory()
	if err != nil {
		conn.Close()
		return nil, err
	}
	currentSource, currentIndex := endpointScope(interfaces, adapter, endpoint)
	if currentSource != source || currentIndex != index {
		conn.Close()
		return nil, ErrPeerScope
	}
	return conn.(*tls.Conn), nil
}

// MatchTrusted verifies possession of a saved key without sending local identity.
func MatchTrusted(ctx context.Context, adapter string, endpoint netip.AddrPort,
	inventory func() ([]networking.Interface, error), trusted func(string) (bool, error)) (string, error) {
	var matched string
	config := &tls.Config{
		MinVersion: tls.VersionTLS13, NextProtos: []string{protocol}, SessionTicketsDisabled: true,
		InsecureSkipVerify: true, // VerifyConnection requires an already trusted key.
		VerifyConnection: func(state tls.ConnectionState) error {
			fingerprint, err := certificateFingerprint(state, protocol)
			if err != nil {
				return err
			}
			pin := fingerprint.String()
			ok, err := trusted(pin)
			if err != nil {
				return err
			}
			if !ok {
				return ErrPeerIdentity
			}
			matched = pin
			return nil
		},
	}
	if err := verify(ctx, adapter, endpoint, inventory, config, false); err != nil {
		return "", err
	}
	return matched, nil
}

//go:build (darwin || linux) && cgo

package local

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"

	"lanvory.local/core/internal/networking"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/storage"
)

func TestTrustRequiresVerificationAndRevocationBlocksMutual(t *testing.T) {
	dir := t.TempDir()
	const owner = "local-test-owner"
	if _, err := storage.LoadProfile(dir, owner, "Local test"); err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("A", 64)
	verifyErr := peer.ErrPeerIdentity
	mutualCalls := 0
	verify := func(context.Context, string, netip.AddrPort, peer.Fingerprint, func() ([]networking.Interface, error)) error {
		return verifyErr
	}
	mutual := func(context.Context, string, netip.AddrPort, peer.Fingerprint, func() ([]networking.Interface, error)) error {
		mutualCalls++
		return nil
	}
	handler := handlerWithReceiverAndVerifier(Device{ID: owner, Fingerprint: strings.Repeat("b", 64)}, dir, nil, verify, mutual, mutual, nil, nil, nil, nil)
	query := url.Values{"interface": {"en0"}, "endpoint": {"192.168.1.40:1234"}, "fingerprint": {pin}}.Encode()
	request := func(method, path string, want int) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, path, nil))
		if response.Code != want {
			t.Fatalf("%s %s: got %d want %d (%s)", method, path, response.Code, want, response.Body)
		}
	}
	request(http.MethodPost, trustRoute+"?"+query, http.StatusUnprocessableEntity)
	request(http.MethodPost, verifyTrustedRoute+"?"+query, http.StatusForbidden)
	verifyErr = nil
	request(http.MethodPost, verifyPeerRoute+"?"+query, http.StatusNoContent)
	request(http.MethodPost, verifyTrustedRoute+"?"+query, http.StatusForbidden)
	request(http.MethodPost, trustRoute+"?"+query, http.StatusNoContent)
	records, err := storage.TrustedPeers(dir, owner)
	if err != nil || len(records) != 1 || records[0].Fingerprint != strings.ToLower(pin) {
		t.Fatalf("trust = %v, %v", records, err)
	}
	request(http.MethodPost, verifyTrustedRoute+"?"+query, http.StatusNoContent)
	request(http.MethodDelete, trustRoute+"/"+pin, http.StatusNoContent)
	request(http.MethodPost, verifyTrustedRoute+"?"+query, http.StatusForbidden)
	if mutualCalls != 1 {
		t.Fatalf("mutual verifier called %d times", mutualCalls)
	}
}

func TestMatchTrustedRejectsUnapprovedAdapter(t *testing.T) {
	dir := t.TempDir()
	owner := Device{ID: "match-test-owner"}
	if _, err := storage.LoadProfile(dir, owner.ID, "Local test"); err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("a", 64)
	if err := storage.SetPeerTrust(dir, owner.ID, pin, true); err != nil {
		t.Fatal(err)
	}
	handler := Handler(owner, dir)
	query := url.Values{"interface": {"lanvory-test"}, "endpoint": {"192.168.1.42:43110"}}
	reply := httptest.NewRecorder()
	handler.ServeHTTP(reply, httptest.NewRequest(http.MethodPost, matchTrustedRoute+"?"+query.Encode(), nil))
	if reply.Code != http.StatusOK || strings.TrimSpace(reply.Body.String()) != `""` {
		t.Fatalf("unapproved endpoint matched: %d %s", reply.Code, reply.Body)
	}
}

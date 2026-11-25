package peer

import (
	"encoding/hex"
	"net/netip"
	"strings"
	"testing"

	"lanvory.local/core/internal/networking"
)

func TestParseFingerprint(t *testing.T) {
	valid := strings.Repeat("aB", 32)
	fingerprint, err := ParseFingerprint(valid)
	if err != nil || hex.EncodeToString(fingerprint[:]) != strings.ToLower(valid) {
		t.Fatalf("unexpected fingerprint: %v", err)
	}
	for _, invalid := range []string{"", valid[:63], valid + "a", strings.Repeat("z", 64)} {
		if _, err := ParseFingerprint(invalid); err == nil {
			t.Fatal("accepted malformed fingerprint")
		}
	}
}

func TestEndpointScope(t *testing.T) {
	nics := []networking.Interface{{
		Name: "en0", Index: 2, Approved: true, Eligible: true, Addresses: []string{"192.168.1.20/24"},
	}}
	source, index := endpointScope(nics, "en0", netip.MustParseAddrPort("192.168.1.21:443"))
	if source.String() != "192.168.1.20" || index != 2 {
		t.Fatalf("selected source = %s index = %d", source, index)
	}
	for _, endpoint := range []string{"192.168.1.21:0", "192.168.2.21:443", "192.168.1.20:443", "192.168.1.255:443", "1.1.1.1:443"} {
		if _, index := endpointScope(nics, "en0", netip.MustParseAddrPort(endpoint)); index != 0 {
			t.Fatalf("allowed out-of-scope endpoint %s", endpoint)
		}
	}
}

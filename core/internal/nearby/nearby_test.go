package nearby

import (
	"testing"
)

func TestSanitizePeersUntrustedMetadata(t *testing.T) {
	in := []Peer{{
		ID:          "uuid-123\n\r",
		Name:        "<script>alert(1)</script>MacBook Pro",
		Tag:         "abc123!@#$",
		RSSI:        -55,
		Transport:   "ble+awdl",
		P2PReady:    true,
		ServiceName: "MacBook-abc123;rm -rf /",
	}}
	got := sanitizePeers(in)
	if len(got) != 1 {
		t.Fatalf("expected 1 peer, got %d", len(got))
	}
	if got[0].Name != "scriptalert1scriptMacBook Pro" {
		t.Fatalf("unexpected sanitized name %q", got[0].Name)
	}
	if got[0].Tag != "abc123" {
		t.Fatalf("unexpected sanitized tag %q", got[0].Tag)
	}
	if got[0].ServiceName != "MacBook-abc123rm -rf" {
		t.Fatalf("unexpected sanitized serviceName %q", got[0].ServiceName)
	}
}

func TestManagerDefaultsDisabled(t *testing.T) {
	m := NewManager("Test Mac", "deadbeef")
	m.helperPath = ""
	m.status.Available = false
	res := m.Status()
	if res.Status.Advertising || res.Status.Scanning {
		t.Fatalf("expected nearby advertising/scanning disabled by default")
	}
}

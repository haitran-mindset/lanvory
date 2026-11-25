package networking

import (
	"net"
	"testing"
)

func TestAdapterPolicyEligibility(t *testing.T) {
	base := net.FlagUp | net.FlagMulticast | net.FlagBroadcast
	cases := []struct {
		name     string
		flags    net.Flags
		address  string
		eligible bool
		hasKey   bool
	}{
		{"private IPv4", base, "192.168.1.3/24", true, true},
		{"link-local IPv4", base, "169.254.1.3/16", true, true},
		{"public IPv4", base, "8.8.8.8/24", false, true},
		{"IPv6 only", base, "fe80::1/64", false, true},
		{"point-to-point", base | net.FlagPointToPoint, "10.0.0.2/24", false, false},
		{"loopback", base | net.FlagLoopback, "10.0.0.2/24", false, false},
		{"down", base &^ net.FlagUp, "10.0.0.2/24", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			nic := net.Interface{Flags: tc.flags, HardwareAddr: net.HardwareAddr{1, 2, 3, 4, 5, 6}}
			key, eligible := adapterPolicy(nic, []string{tc.address})
			if eligible != tc.eligible || (key != "") != tc.hasKey {
				t.Fatalf("unexpected adapter policy: eligible=%t, hasKey=%t", eligible, key != "")
			}
		})
	}
}

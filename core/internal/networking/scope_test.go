package networking

import (
	"net/netip"
	"testing"
)

func TestCheckScope(t *testing.T) {
	interfaces := []Interface{
		{Name: "en0", Index: 2, Approved: true, Eligible: true, Addresses: []string{"10.0.2.4/24", "10.0.2.129/25", "169.254.50.2/16"}},
		{Name: "en1", Index: 3, Eligible: true, Addresses: []string{"10.0.2.8/24"}},
		{Name: "en2", Index: 4, Approved: true, Addresses: []string{"10.0.2.7/24"}},
		{Name: "en3", Index: 5, Approved: true, Eligible: true, Addresses: []string{"192.168.2.0/31"}},
		{Name: "wide", Index: 6, Approved: true, Eligible: true, Addresses: []string{"10.0.0.2/0"}},
	}
	cases := []struct {
		name, nic, target string
		want              ScopeCheck
	}{
		{"same subnet", "en0", "10.0.2.3", ScopeCheck{Allowed: true, Source: "10.0.2.4", Subnet: "10.0.2.0/24"}},
		{"longest subnet", "en0", "10.0.2.150", ScopeCheck{Allowed: true, Source: "10.0.2.129", Subnet: "10.0.2.128/25"}},
		{"link local", "en0", "169.254.50.3", ScopeCheck{Allowed: true, Source: "169.254.50.2", Subnet: "169.254.0.0/16"}},
		{"slash 31", "en3", "192.168.2.1", ScopeCheck{Allowed: true, Source: "192.168.2.0", Subnet: "192.168.2.0/31"}},
		{"network", "en0", "10.0.2.0", ScopeCheck{Reason: "destination_is_network_or_broadcast"}},
		{"overlapping network", "en0", "10.0.2.128", ScopeCheck{Reason: "destination_is_network_or_broadcast"}},
		{"broadcast", "en0", "10.0.2.255", ScopeCheck{Reason: "destination_is_network_or_broadcast"}},
		{"off-link private", "en0", "10.0.3.2", ScopeCheck{Reason: "destination_outside_interface_subnet"}},
		{"same host on another interface", "en0", "10.0.2.8", ScopeCheck{Reason: "destination_is_local_address"}},
		{"public", "en0", "8.8.8.8", ScopeCheck{Reason: "destination_outside_lan_ranges"}},
		{"multicast", "en0", "224.0.0.251", ScopeCheck{Reason: "destination_outside_lan_ranges"}},
		{"unapproved", "en1", "10.0.2.3", ScopeCheck{Reason: "interface_not_active_and_approved"}},
		{"inactive", "en2", "10.0.2.3", ScopeCheck{Reason: "interface_not_active_and_approved"}},
		{"overbroad prefix", "wide", "10.0.2.3", ScopeCheck{Reason: "destination_outside_interface_subnet"}},
		{"missing", "en9", "10.0.2.3", ScopeCheck{Reason: "interface_not_active_and_approved"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CheckScope(interfaces, tc.nic, netip.MustParseAddr(tc.target)); got != tc.want {
				t.Fatalf("CheckScope = %+v, want %+v", got, tc.want)
			}
		})
	}
}

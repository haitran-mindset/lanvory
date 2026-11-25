package networking

import "net/netip"

// ScopeCheck describes an address policy decision without inspecting OS routes
// or opening a network connection.
type ScopeCheck struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
	Source  string `json:"source,omitempty"`
	Subnet  string `json:"subnet,omitempty"`
}

func isLANIPv4(addr netip.Addr) bool {
	return addr.Is4() && (addr.IsPrivate() || addr.IsLinkLocalUnicast())
}

// ListenerIndex validates an exact local bind address.
func ListenerIndex(interfaces []Interface, name string, source netip.Addr) int {
	if !isLANIPv4(source) {
		return 0
	}
	for _, nic := range interfaces {
		if nic.Name != name || !nic.Approved || !nic.Eligible || nic.Index <= 0 {
			continue
		}
		for _, address := range nic.Addresses {
			prefix, err := netip.ParsePrefix(address)
			if err == nil && prefix.Addr() == source && prefix.Bits() >= minimumLANBits(source) &&
				prefix.Bits() < 32 && (prefix.Bits() == 31 || !isReservedHost(prefix.Masked(), source)) {
				return nic.Index
			}
		}
	}
	return 0
}

func CheckScope(interfaces []Interface, name string, destination netip.Addr) ScopeCheck {
	if !isLANIPv4(destination) {
		return ScopeCheck{Reason: "destination_outside_lan_ranges"}
	}

	var selected *Interface
	for i := range interfaces {
		if interfaces[i].Name == name {
			selected = &interfaces[i]
			break
		}
	}
	if selected == nil || !selected.Approved || !selected.Eligible || selected.Index <= 0 {
		return ScopeCheck{Reason: "interface_not_active_and_approved"}
	}

	for _, nic := range interfaces {
		for _, address := range nic.Addresses {
			prefix, err := netip.ParsePrefix(address)
			if err == nil && prefix.Addr() == destination {
				return ScopeCheck{Reason: "destination_is_local_address"}
			}
		}
	}

	bestBits := -1
	result := ScopeCheck{Reason: "destination_outside_interface_subnet"}
	for _, address := range selected.Addresses {
		prefix, err := netip.ParsePrefix(address)
		if err != nil || !isLANIPv4(prefix.Addr()) || prefix.Bits() < minimumLANBits(prefix.Addr()) {
			continue
		}
		// Private and link-local addresses must stay within their own class.
		if prefix.Addr().IsLinkLocalUnicast() != destination.IsLinkLocalUnicast() {
			continue
		}
		subnet := prefix.Masked()
		if !subnet.Contains(destination) {
			continue
		}
		if subnet.Bits() < 31 && isReservedHost(subnet, destination) {
			// A broader alias must not admit a reserved address on this link.
			return ScopeCheck{Reason: "destination_is_network_or_broadcast"}
		}
		if subnet.Bits() > bestBits {
			bestBits = subnet.Bits()
			result = ScopeCheck{Allowed: true, Source: prefix.Addr().String(), Subnet: subnet.String()}
		}
	}
	return result
}

// A usable prefix must fit entirely inside one private or link-local block.
func minimumLANBits(addr netip.Addr) int {
	switch addr.As4()[0] {
	case 10:
		return 8
	case 172:
		return 12
	default:
		return 16
	}
}

func isReservedHost(subnet netip.Prefix, destination netip.Addr) bool {
	if destination == subnet.Addr() {
		return true
	}
	broadcast := subnet.Addr().As4()
	hostBits := 32 - subnet.Bits()
	for i := len(broadcast) - 1; i >= 0 && hostBits > 0; i-- {
		bits := min(hostBits, 8)
		broadcast[i] |= byte((1 << bits) - 1)
		hostBits -= bits
	}
	return destination == netip.AddrFrom4(broadcast)
}

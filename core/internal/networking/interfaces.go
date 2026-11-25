package networking

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/netip"
)

type Interface struct {
	Name        string   `json:"name"`
	Index       int      `json:"index"`
	Up          bool     `json:"up"`
	Loopback    bool     `json:"loopback"`
	Multicast   bool     `json:"multicast"`
	Addresses   []string `json:"addresses"`
	Eligible    bool     `json:"eligible"`
	Approved    bool     `json:"approved"`
	approvalKey string
}

func Interfaces(approvals map[string]string) ([]Interface, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list network interfaces: %w", err)
	}
	snapshots := make([]Interface, 0, len(interfaces))
	for _, nic := range interfaces {
		addresses, err := nic.Addrs()
		if err != nil {
			return nil, fmt.Errorf("list interface addresses: %w", err)
		}
		snapshot := Interface{
			Name: nic.Name, Index: nic.Index,
			Up:        nic.Flags&net.FlagUp != 0,
			Loopback:  nic.Flags&net.FlagLoopback != 0,
			Multicast: nic.Flags&net.FlagMulticast != 0,
			Addresses: make([]string, 0, len(addresses)),
		}
		for _, address := range addresses {
			snapshot.Addresses = append(snapshot.Addresses, address.String())
		}
		snapshot.approvalKey, snapshot.Eligible = adapterPolicy(nic, snapshot.Addresses)
		snapshot.Approved = snapshot.approvalKey != "" && approvals[nic.Name] == snapshot.approvalKey
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

// ApprovalKey identifies the adapter for local policy persistence.
func ApprovalKey(name string) (string, error) {
	interfaces, err := Interfaces(nil)
	if err != nil {
		return "", err
	}
	for _, nic := range interfaces {
		if nic.Name == name && nic.Eligible {
			return nic.approvalKey, nil
		}
	}
	return "", nil
}

func adapterPolicy(nic net.Interface, addresses []string) (string, bool) {
	if nic.Flags&(net.FlagLoopback|net.FlagPointToPoint) != 0 ||
		nic.Flags&(net.FlagBroadcast|net.FlagMulticast) != net.FlagBroadcast|net.FlagMulticast ||
		len(nic.HardwareAddr) != 6 {
		return "", false
	}
	digest := sha256.Sum256(nic.HardwareAddr)
	key := hex.EncodeToString(digest[:])
	if nic.Flags&net.FlagUp == 0 {
		return key, false
	}
	for _, address := range addresses {
		prefix, err := netip.ParsePrefix(address)
		if err != nil {
			continue
		}
		ip := prefix.Addr()
		if isLANIPv4(ip) {
			return key, true
		}
	}
	return key, false
}

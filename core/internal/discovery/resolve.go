package discovery

import (
	"context"
	"errors"
	"net/netip"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"lanvory.local/core/internal/networking"
)

var ErrInactiveInterface = errors.New("interface is unavailable or ineligible")
var ErrServiceNotFound = errors.New("Bonjour service was not resolved")

type Resolution struct {
	Name              string   `json:"name"`
	Interface         string   `json:"interface"`
	Transport         string   `json:"transport"`
	Endpoints         []string `json:"endpoints"`
	RejectedAddresses int      `json:"rejectedAddresses"`
}

func ValidServiceName(name string) bool {
	return len(name) > 0 && len(name) <= 63 && utf8.ValidString(name) &&
		!strings.ContainsFunc(name, func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) })
}

func activeIndex(interfaces []networking.Interface, name string) int {
	for _, nic := range interfaces {
		if nic.Name == name && nic.Approved && nic.Eligible && usableIndex(nic.Index) {
			return nic.Index
		}
	}
	return 0
}

type tcpResolver func(int, string) (uint16, []netip.Addr, error)

func ValidTransport(transport string) bool { return transport == "tcp" || transport == "udp" }

func ResolveTCP(ctx context.Context, name, adapter string, inventory func() ([]networking.Interface, error)) (Resolution, error) {
	return Resolve(ctx, name, adapter, "tcp", inventory)
}

func Resolve(ctx context.Context, name, adapter, transport string, inventory func() ([]networking.Interface, error)) (Resolution, error) {
	if !ValidTransport(transport) {
		return Resolution{}, ErrServiceNotFound
	}
	result, err := resolveTCP(ctx, name, adapter, inventory, func(index int, name string) (uint16, []netip.Addr, error) {
		return resolveInterface(index, name, transport)
	})
	if err == nil {
		result.Transport = transport
	}
	return result, err
}

func resolveTCP(ctx context.Context, name, adapter string, inventory func() ([]networking.Interface, error), query tcpResolver) (Resolution, error) {
	if !ValidServiceName(name) {
		return Resolution{}, errors.New("invalid Bonjour service name")
	}
	if err := ctx.Err(); err != nil {
		return Resolution{}, err
	}
	interfaces, err := inventory()
	if err != nil {
		return Resolution{}, err
	}
	index := activeIndex(interfaces, adapter)
	if index == 0 {
		return Resolution{}, ErrInactiveInterface
	}
	port, addresses, err := query(index, name)
	if err != nil {
		return Resolution{}, err
	}
	if err := ctx.Err(); err != nil {
		return Resolution{}, err
	}
	interfaces, err = inventory()
	if err != nil {
		return Resolution{}, err
	}
	if activeIndex(interfaces, adapter) != index {
		return Resolution{}, ErrInactiveInterface
	}
	if port == 0 {
		return Resolution{}, ErrServiceNotFound
	}

	endpoints := make([]string, 0, len(addresses))
	for _, address := range addresses {
		if networking.CheckScope(interfaces, adapter, address).Allowed {
			endpoints = append(endpoints, netip.AddrPortFrom(address, port).String())
		}
	}
	slices.Sort(endpoints)
	return Resolution{Name: name, Interface: adapter, Endpoints: slices.Compact(endpoints), RejectedAddresses: len(addresses) - len(endpoints)}, nil
}

package discovery

import (
	"context"
	"errors"
	"net/netip"
	"slices"
	"testing"

	"lanvory.local/core/internal/networking"
)

func TestResolveTCPFiltersCurrentScope(t *testing.T) {
	inventory := func() ([]networking.Interface, error) {
		return []networking.Interface{
			{Name: "en0", Index: 2, Approved: true, Eligible: true, Addresses: []string{"192.168.1.20/24"}},
		}, nil
	}
	result, err := resolveTCP(context.Background(), "Lanvory test", "en0", inventory,
		func(index int, name string) (uint16, []netip.Addr, error) {
			if index != 2 || name != "Lanvory test" {
				t.Fatal("wrong query scope")
			}
			return 4567, []netip.Addr{
				netip.MustParseAddr("192.168.1.5"),
				netip.MustParseAddr("192.168.1.5"),
				netip.MustParseAddr("192.168.1.20"),
				netip.MustParseAddr("192.168.2.5"),
				netip.MustParseAddr("8.8.8.8"),
				netip.MustParseAddr("224.0.0.251"),
				netip.MustParseAddr("::1"),
			}, nil
		})
	if err != nil || !slices.Equal(result.Endpoints, []string{"192.168.1.5:4567"}) || result.RejectedAddresses != 5 {
		t.Fatalf("resolution = %+v, %v", result, err)
	}
}

func TestResolveTCPChecksApprovalBeforeAndAfterQuery(t *testing.T) {
	approved := false
	inventory := func() ([]networking.Interface, error) {
		return []networking.Interface{{Name: "en0", Index: 2, Eligible: true, Approved: approved}}, nil
	}
	query := func(int, string) (uint16, []netip.Addr, error) {
		if !approved {
			t.Fatal("query ran without approval")
		}
		approved = false
		return 1234, nil, nil
	}
	for _, before := range []bool{false, true} {
		approved = before
		if _, err := resolveTCP(context.Background(), "Lanvory test", "en0", inventory, query); !errors.Is(err, ErrInactiveInterface) {
			t.Fatalf("expected scope rejection; got %v", err)
		}
	}
}

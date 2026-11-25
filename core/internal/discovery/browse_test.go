package discovery

import (
	"context"
	"errors"
	"testing"

	"lanvory.local/core/internal/networking"
)

func TestBrowseScopesQueriesAndResults(t *testing.T) {
	interfaces := []networking.Interface{
		{Name: "approved", Index: 3, Approved: true, Eligible: true},
		{Name: "unapproved", Index: 4, Eligible: true},
		{Name: "inactive", Index: 5, Approved: true},
		{Name: "wildcard", Index: 0, Approved: true, Eligible: true},
	}
	calls := make(chan int, len(interfaces))
	result, err := browse(context.Background(), interfaces, func(index int) ([]instance, bool, error) {
		calls <- index
		return []instance{{"Test peer", "tcp"}}, true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	close(calls)
	if len(calls) != 1 || <-calls != 3 {
		t.Fatal("browse issued queries outside the approved interface")
	}
	if len(result.Interfaces) != 1 || result.Interfaces[0] != "approved" ||
		len(result.Services) != 1 || result.Services[0] != (Service{Name: "Test peer", Interface: "approved", Transport: "tcp"}) || !result.Truncated {
		t.Fatalf("result = %+v", result)
	}
}

func TestBrowseReportsBackendError(t *testing.T) {
	interfaces := []networking.Interface{{Name: "active", Index: 3, Approved: true, Eligible: true}}
	expected := errors.New("backend failed")
	_, err := browse(context.Background(), interfaces, func(int) ([]instance, bool, error) {
		return nil, false, expected
	})
	if !errors.Is(err, expected) {
		t.Fatalf("error = %v", err)
	}
}

func TestBrowseWithoutDiscoveryReportsApprovedAdapters(t *testing.T) {
	interfaces := []networking.Interface{
		{Name: "eth0", Index: 3, Approved: true, Eligible: true},
		{Name: "eth1", Index: 4, Eligible: true},
	}
	result, err := browse(t.Context(), interfaces, nil)
	if err != nil || !result.Unavailable || len(result.Services) != 0 ||
		len(result.Interfaces) != 1 || result.Interfaces[0] != "eth0" {
		t.Fatalf("unavailable discovery result = %+v, error = %v", result, err)
	}
}

//go:build darwin || linux

package local

import (
	"slices"
	"testing"

	"lanvory.local/core/internal/discovery"
)

func TestExcludeLocalServices(t *testing.T) {
	remote := discovery.Service{Name: "Lanvory remote", Interface: "en0", Transport: "tcp"}
	services := []discovery.Service{
		{Name: "Lanvory old", Interface: "en0", Transport: "tcp"},
		remote,
		{Name: "Lanvory new", Interface: "en0", Transport: "udp"},
		{Name: "Lanvory new", Interface: "en0", Transport: "tcp"},
	}
	if got := excludeLocalServices(slices.Clone(services), "Lanvory old", "Lanvory new"); !slices.Equal(got, []discovery.Service{remote}) {
		t.Fatalf("discovery returned %+v", got)
	}
	if got := excludeLocalServices(slices.Clone(services), "", ""); !slices.Equal(got, services) {
		t.Fatalf("discovery without local advertisement returned %+v", got)
	}
}

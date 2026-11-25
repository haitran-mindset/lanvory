package bridge

import (
	"errors"
	"net/netip"

	"lanvory.local/core/internal/permissions"
)

const Protocol = "lanvory-bridge/1"

var ErrNotAvailable = errors.New("shared service is unavailable or not permitted")
var ErrServiceExists = errors.New("service ID already has a different target")
var ErrServiceLimit = errors.New("shared service limit reached")

type Service struct {
	ID     string         `json:"id"`
	Target netip.AddrPort `json:"target"`
}

func ValidID(id string) bool                 { return permissions.ValidResource(permissions.ConnectService, id) }
func ValidTarget(target netip.AddrPort) bool { return target.Port() != 0 && ValidBind(target) }

func ValidBind(bind netip.AddrPort) bool {
	addr := bind.Addr()
	return addr.IsValid() && !addr.Is4In6() && addr.Zone() == "" && addr.IsLoopback()
}

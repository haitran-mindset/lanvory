package discovery

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"lanvory.local/core/internal/networking"
)

type Service struct {
	Name      string `json:"name"`
	Interface string `json:"interface"`
	Transport string `json:"transport"`
}

type Result struct {
	Interfaces  []string  `json:"interfaces"`
	Services    []Service `json:"services"`
	Truncated   bool      `json:"truncated"`
	Unavailable bool      `json:"unavailable,omitempty"`
}

func Browse(ctx context.Context, interfaces []networking.Interface) (Result, error) {
	if !CanPublish {
		return browse(ctx, interfaces, nil)
	}
	return browse(ctx, interfaces, browseInterface)
}

type instance struct {
	name      string
	transport string
}

type interfaceBrowser func(int) ([]instance, bool, error)

func usableIndex(index int) bool {
	return index > 0 && uint64(index) < (1<<32)-5
}

func browse(ctx context.Context, interfaces []networking.Interface, query interfaceBrowser) (Result, error) {
	result := Result{Interfaces: []string{}, Services: []Service{}}
	var eligible []networking.Interface
	for _, nic := range interfaces {
		if nic.Approved && nic.Eligible && usableIndex(nic.Index) {
			eligible = append(eligible, nic)
			result.Interfaces = append(result.Interfaces, nic.Name)
		}
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if query == nil {
		result.Unavailable = true
		slices.Sort(result.Interfaces)
		return result, nil
	}
	if len(eligible) > 8 {
		return Result{}, errors.New("too many approved interfaces for a discovery scan")
	}
	type reply struct {
		name      string
		names     []instance
		truncated bool
		err       error
	}
	replies := make(chan reply, len(eligible))
	for _, nic := range eligible {
		go func() {
			names, truncated, err := query(nic.Index)
			replies <- reply{nic.Name, names, truncated, err}
		}()
	}
	// Drain every reply before releasing the daemon's discovery lock.
	var scanErr error
	for range eligible {
		reply := <-replies
		if reply.err != nil {
			scanErr = errors.Join(scanErr, fmt.Errorf("browse interface %s: %w", reply.name, reply.err))
			continue
		}
		result.Truncated = result.Truncated || reply.truncated
		for _, service := range reply.names {
			result.Services = append(result.Services, Service{Name: service.name, Interface: reply.name, Transport: service.transport})
		}
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if scanErr != nil {
		return Result{}, scanErr
	}
	slices.Sort(result.Interfaces)
	slices.SortFunc(result.Services, func(a, b Service) int {
		if order := strings.Compare(a.Interface, b.Interface); order != 0 {
			return order
		}
		if order := strings.Compare(a.Name, b.Name); order != 0 {
			return order
		}
		return strings.Compare(a.Transport, b.Transport)
	})
	return result, nil
}

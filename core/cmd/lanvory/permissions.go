//go:build darwin || linux

package main

import (
	"context"
	"encoding/json"
	"errors"

	"lanvory.local/core/internal/local"
)

func validPermissionCommand(args []string) bool {
	if len(args) < 2 || args[0] != "permissions" {
		return false
	}
	switch args[1] {
	case "list", "audit":
		return len(args) == 2
	case "check", "revoke":
		return len(args) == 5
	case "grant":
		return len(args) == 5 || len(args) == 6
	default:
		return false
	}
}

func runPermissions(ctx context.Context, dir string, output *json.Encoder, args []string) error {
	switch args[0] {
	case "list":
		grants, err := local.ListGrants(ctx, dir)
		if err != nil {
			return err
		}
		return output.Encode(grants)
	case "audit":
		events, err := local.ListPermissionEvents(ctx, dir)
		if err != nil {
			return err
		}
		return output.Encode(events)
	case "check":
		decision, err := local.CheckGrant(ctx, dir, args[1], args[2], args[3])
		if err != nil {
			return err
		}
		return output.Encode(decision)
	case "revoke":
		return local.UpdateGrant(ctx, dir, args[1], args[2], args[3], "", false)
	case "grant":
		expiry := ""
		if len(args) == 5 {
			expiry = args[4]
			if expiry == "" {
				return errors.New("expiration must be an RFC3339 timestamp")
			}
		}
		return local.UpdateGrant(ctx, dir, args[1], args[2], args[3], expiry, true)
	default:
		return errors.New("invalid permissions command")
	}
}

//go:build darwin || linux

package local

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"sync"
	"time"

	"lanvory.local/core/internal/bridge"
	"lanvory.local/core/internal/peer"
	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/storage"
)

const grantsRoute = "/v1/permissions"
const permissionCheckRoute = grantsRoute + "/check"
const permissionEventRoute = grantsRoute + "/audit"
const permissionGrantRoute = grantsRoute + "/grant"

type PermissionDecision struct {
	Allowed bool `json:"allowed"`
}

func registerPermissions(mux *http.ServeMux, dir, owner string, policyMu *sync.Mutex) {
	mux.HandleFunc("GET "+grantsRoute, func(w http.ResponseWriter, _ *http.Request) {
		grants, err := storage.Grants(dir, owner)
		if err != nil {
			http.Error(w, "Unable to list permissions", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, grants)
	})
	mux.HandleFunc("GET "+permissionEventRoute, func(w http.ResponseWriter, _ *http.Request) {
		events, err := storage.PermissionEvents(dir, owner)
		if err != nil {
			http.Error(w, "Unable to list permission events", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, events)
	})
	mux.HandleFunc("GET "+permissionCheckRoute, func(w http.ResponseWriter, r *http.Request) {
		grant, err := grantFromRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		allowed, err := storage.HasGrant(dir, owner, grant, time.Now())
		if err != nil {
			http.Error(w, "Unable to check permission", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, PermissionDecision{Allowed: allowed})
	})
	change := func(w http.ResponseWriter, r *http.Request) {
		grant, err := grantFromRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		policyMu.Lock()
		defer policyMu.Unlock()
		if r.Context().Err() != nil {
			return
		}
		err = storage.SetGrant(dir, owner, grant, r.Method == http.MethodPut)
		switch {
		case errors.Is(err, storage.ErrUntrustedPeer):
			http.Error(w, err.Error(), http.StatusForbidden)
		case errors.Is(err, bridge.ErrNotAvailable):
			http.Error(w, err.Error(), http.StatusNotFound)
		case errors.Is(err, storage.ErrGrantLimit):
			http.Error(w, err.Error(), http.StatusInsufficientStorage)
		case err != nil:
			http.Error(w, "Unable to update permission", http.StatusServiceUnavailable)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
	mux.HandleFunc("PUT "+permissionGrantRoute, change)
	mux.HandleFunc("DELETE "+permissionGrantRoute, change)
}

func grantFromRequest(r *http.Request) (storage.Grant, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query["fingerprint"]) != 1 || len(query["capability"]) != 1 || len(query["resource"]) != 1 {
		return storage.Grant{}, errors.New("expected peer fingerprint, capability and resource")
	}
	expiry, hasExpiry := query["expires"]
	if hasExpiry {
		if r.Method != http.MethodPut || len(query) != 4 || len(expiry) != 1 || expiry[0] == "" {
			return storage.Grant{}, errors.New("invalid permission query")
		}
	} else if len(query) != 3 {
		return storage.Grant{}, errors.New("invalid permission query")
	}
	return parseGrant(query.Get("fingerprint"), query.Get("capability"), query.Get("resource"), query.Get("expires"))
}

func parseGrant(pin, capability, resource, expiry string) (storage.Grant, error) {
	fingerprint, err := peer.ParseFingerprint(pin)
	if err != nil {
		return storage.Grant{}, err
	}
	if !permissions.ValidResource(capability, resource) {
		return storage.Grant{}, errors.New("expected a supported capability and a lowercase resource ID")
	}
	grant := storage.Grant{Fingerprint: fingerprint.String(), Capability: capability, Resource: resource}
	if expiry != "" {
		expires, err := time.Parse(time.RFC3339, expiry)
		if err != nil || expires.Unix() <= time.Now().Unix() {
			return storage.Grant{}, errors.New("expected an expiration in the future (RFC3339)")
		}
		expires = expires.UTC()
		grant.ExpiresAt = &expires
	}
	return grant, nil
}

func permissionQuery(grant storage.Grant) string {
	query := url.Values{"fingerprint": {grant.Fingerprint}, "capability": {grant.Capability}, "resource": {grant.Resource}}
	if grant.ExpiresAt != nil {
		query.Set("expires", grant.ExpiresAt.Format(time.RFC3339))
	}
	return "?" + query.Encode()
}

func UpdateGrant(ctx context.Context, dir, pin, capability, resource, expiry string, allow bool) error {
	grant, err := parseGrant(pin, capability, resource, expiry)
	if err != nil {
		return err
	}
	method := http.MethodDelete
	if allow {
		method = http.MethodPut
	}
	return requestLocal(ctx, dir, method, permissionGrantRoute+permissionQuery(grant), nil)
}

func CheckGrant(ctx context.Context, dir, pin, capability, resource string) (PermissionDecision, error) {
	grant, err := parseGrant(pin, capability, resource, "")
	if err != nil {
		return PermissionDecision{}, err
	}
	var decision PermissionDecision
	err = requestLocal(ctx, dir, http.MethodGet, permissionCheckRoute+permissionQuery(grant), &decision)
	return decision, err
}

func ListGrants(ctx context.Context, dir string) ([]storage.Grant, error) {
	var grants []storage.Grant
	err := requestLocal(ctx, dir, http.MethodGet, grantsRoute, &grants)
	return grants, err
}

func ListPermissionEvents(ctx context.Context, dir string) ([]storage.PermissionEvent, error) {
	var events []storage.PermissionEvent
	err := requestLocal(ctx, dir, http.MethodGet, permissionEventRoute, &events)
	return events, err
}

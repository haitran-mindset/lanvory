//go:build (darwin || linux) && cgo

package local

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lanvory.local/core/internal/permissions"
	"lanvory.local/core/internal/storage"
)

func TestPermissionRoutes(t *testing.T) {
	dir := t.TempDir()
	const owner = "own-key"
	if _, err := storage.LoadProfile(dir, owner, "Device"); err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("a", 64)
	handler := Handler(Device{ID: owner}, dir)
	params := permissionQuery(storage.Grant{Fingerprint: pin, Capability: permissions.ReceiveFile, Resource: "inbox"})
	request := func(method, path string, status int, body string) {
		t.Helper()
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, httptest.NewRequest(method, path, nil))
		if result.Code != status || !strings.Contains(result.Body.String(), body) {
			t.Fatalf("%s %s = %d %q, expected %d containing %q", method, path, result.Code, result.Body.String(), status, body)
		}
	}
	request(http.MethodGet, permissionCheckRoute+params, http.StatusOK, `"allowed":false`)
	request(http.MethodPut, permissionGrantRoute+params, http.StatusForbidden, "")
	if err := storage.SetPeerTrust(dir, owner, pin, true); err != nil {
		t.Fatal(err)
	}
	request(http.MethodPut, permissionGrantRoute+params+"&expires=bad", http.StatusBadRequest, "")
	request(http.MethodPut, permissionGrantRoute+params, http.StatusNoContent, "")
	request(http.MethodGet, permissionCheckRoute+params, http.StatusOK, `"allowed":true`)
	request(http.MethodGet, grantsRoute, http.StatusOK, `"resource":"inbox"`)
	request(http.MethodDelete, permissionGrantRoute+params, http.StatusNoContent, "")
	request(http.MethodGet, permissionCheckRoute+params, http.StatusOK, `"allowed":false`)
	request(http.MethodGet, permissionEventRoute, http.StatusOK, `"action":"revoked"`)
}

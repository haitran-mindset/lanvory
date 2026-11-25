package storage

import (
	"errors"
	"time"
)

var ErrGrantLimit = errors.New("resource grant limit reached")
var ErrUntrustedPeer = errors.New("peer fingerprint is not in the trust store")

type Grant struct {
	Fingerprint string     `json:"fingerprint"`
	Capability  string     `json:"capability"`
	Resource    string     `json:"resource"`
	Inactive    bool       `json:"inactive,omitempty"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
}

type PermissionEvent struct {
	Grant
	Action     string    `json:"action"`
	OccurredAt time.Time `json:"occurredAt"`
}

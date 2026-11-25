package local

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"runtime"
	"time"
)

const IdentityRoute = "/v1/identity"

type Device struct {
	CreatedAt       time.Time `json:"createdAt"`
	ID              string    `json:"id"`
	Fingerprint     string    `json:"fingerprint"`
	PublicKey       string    `json:"publicKey"`
	Name            string    `json:"name"`
	OS              string    `json:"os"`
	ProtocolVersion int       `json:"protocolVersion"`
	DaemonVersion   string    `json:"daemonVersion,omitempty"`
}

func Describe(key ed25519.PublicKey) Device {
	digest := sha256.Sum256(key)
	fingerprint := hex.EncodeToString(digest[:])
	name, err := os.Hostname()
	if err != nil || name == "" {
		name = "Lanvory device"
	}
	return Device{
		ID: "ed25519-v1:" + fingerprint, Fingerprint: fingerprint,
		PublicKey: base64.StdEncoding.EncodeToString(key),
		Name:      name, OS: runtime.GOOS, ProtocolVersion: 1,
	}
}

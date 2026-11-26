# Local IPC v1

The daemon listens on a Unix domain socket at `~/.lanvory/daemon.sock` by default. For isolated development and packaging tests, `LANVORY_STATE_DIR` selects an absolute private directory. The directory and socket require modes 0700 and 0600 respectively. Both ends use kernel peer credentials to verify the effective user ID. This authorizes the local OS account. Processes running as that user can access the protocol.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/v1/identity` | Device ID, SHA-256 fingerprint, Ed25519 public key, name, OS, protocol version, and the UTC time the profile was initialized |
| POST | `/v1/settings/device-name?name=NAME` | Updates the local device name in SQLite and returns the updated public identity. |
| GET | `/v1/network/listener` | Reports local-only, listening, or stopped TCP listener state, including its bound endpoint and pairing availability when listening. |
| POST | `/v1/network/listener/start?interface=NAME&bind=IPv4:PORT` | Starts the approved, scoped TCP and QUIC listener with Bonjour. Incoming pairing is enabled by default, and the optional `pairing=false` query disables it. |
| POST | `/v1/network/listener/stop` | Stops and drains the listener without stopping the local daemon. |
| GET | `/v1/network/interfaces` | Local interface names, indices, flags, CIDR addresses, and approval and eligibility flags. Returns 503 when inventory or approvals cannot be read. |
| GET | `/v1/network/scope?interface=NAME&address=IPv4` | Evaluates address policy against the current interface inventory. Returns a decision with a source/subnet or a rejection reason. Invalid input returns 400. |
| POST | `/v1/discovery/resolve?interface=NAME&name=INSTANCE` | Scoped SRV/A lookup. Optional `transport=udp` selects the UDP service; TCP is the default. Returns candidate IPv4 endpoints and a rejected-address count, or 404 if the service cannot be resolved. |
| POST | `/v1/discovery/scan` | Bounded DNS-SD snapshot over active approved interfaces. Returns 429 when discovery or an approval write is in progress, or 503 when the scan fails. |
| GET | `/v1/nearby/status` | Reports the Bluetooth and Wi-Fi P2P helper state. |
| POST | `/v1/nearby/advertise` | Enables or disables advertising based on the JSON `enabled` field. |
| POST | `/v1/nearby/scan` | Returns nearby Bluetooth and Wi-Fi P2P discovery candidates. |
| POST | `/v1/nearby/connect` | Establishes a helper-managed loopback bridge for a discovered Wi-Fi P2P service. |
| POST | `/v1/nearby/pair` | Starts confirmed pairing against a registered helper-managed bridge endpoint. |
| POST | `/v1/peer/verify?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX` | Verifies the peer key over TLS 1.3 on the approved adapter. Returns 204 on success, 409 on scope denial, or 422 on a failed key/protocol check. |
| POST | `/v1/peers/trust?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX` | Verify the remote key before persisting approval for this local identity. |
| GET | `/v1/peers/trust` | List fingerprints and first verification timestamps for this local identity. |
| DELETE | `/v1/peers/trust/{fingerprint}` | Revoke a local peer approval. |
| POST | `/v1/peer/verify-quic?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX` | Requires saved peer trust and a QUIC mutual verification stream. |
| POST | `/v1/peer/verify-trusted?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX` | Require saved trust locally and verify both peer identities with the trusted TLS protocol. |
| GET | `/v1/permissions` | Lists exact per-peer resource grants for the current device. |
| GET | `/v1/permissions/audit` | Lists the latest local permission changes. |
| GET | `/v1/permissions/check?fingerprint=HEX&capability=TYPE&resource=ID` | Reports whether a matching permission is currently valid. |
| PUT or DELETE | `/v1/permissions/grant?fingerprint=HEX&capability=TYPE&resource=ID` | Sets or deletes an exact grant. PUT accepts optional `expires` in RFC3339 and requires trust. |
| GET | `/v1/pairing` | Lists outstanding local pairing decisions and TLS-derived codes. |
| POST | `/v1/pairing/start?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX` | Starts scoped pinned pairing and waits for both persistence receipts. |
| POST | `/v1/pairing/{id}/{decision}` | Approves with the full `code` query value, with or without group separators, on approve, or declines without arguments. |
| GET | `/v1/tunnels` | Lists local loopback listeners and current connection counts. |
| POST | `/v1/tunnels?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX&service=ID&bind=LOOPBACK:PORT` | Binds a loopback listener if local trust and adapter scope are valid. |
| DELETE | `/v1/tunnels/{id}` | Stops a loopback listener and its active connections. |
| GET | `/v1/services` | Lists locally registered service IDs and loopback targets. |
| PUT or DELETE | `/v1/services/{id}` | Registers a literal loopback target provided by query `target` on PUT, or removes the service and its grants on DELETE. |
| GET | `/v1/files/transfers` | Lists live transfers and recent terminal history, with a history failure indicator. |
| GET | `/v1/files/offers` | Lists incoming file offers awaiting a local decision. |
| POST | `/v1/files/offers/{id}/{decision}` | Approves or declines an offer once. |
| POST | `/v1/files/send?interface=NAME&endpoint=IPv4:PORT&fingerprint=HEX&path=ABSOLUTE_PATH` | Sends the explicitly selected local file. Waits for remote approval and integrity confirmation. |
| PUT | `/v1/network/interfaces/{name}/approval` | Saves approval for the current eligible adapter. Returns 204 or 409 if unavailable or ineligible. |
| DELETE | `/v1/network/interfaces/{name}/approval` | Revokes the named approval, including for an absent adapter. Returns 204 after committing the change. |

The CLI bounds the response size and lifetime and refuses HTTP redirects. Daemon timeouts bound idle connections and request processing. When the daemon stops, the Unix socket is removed on a graceful close. The next daemon can replace a stale socket while holding the exclusive instance lock.

Electron preload exposes identity, interface inventory, explicit discovery, verified peer trust management, single-file transfer controls, and service and tunnel management. Desktop file selection uses the native picker. Only the selected basename is returned to the renderer. Main validates the current window, main frame and loaded file URL before calling the CLI. The CLI approval mutations stay on this Unix socket. Adapter approval mutation stays in the CLI.

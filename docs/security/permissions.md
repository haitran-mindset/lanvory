# Peer resource permissions

Authentication establishes a peer's Ed25519 identity. Authorization then checks an exact tuple consisting of the current local device ID, the remote fingerprint, the operation, and a resource ID. Missing and expired grants deny the operation. A fresh install and a migration from existing trust records start with no grants.

The initial policy vocabulary is `file-receive` for a named receiving inbox and `service-connect` for a named shared service. Resource IDs are lowercase slugs. A grant carries a resource identifier, never a hostname, address, path, or port supplied by the remote peer. A resource operation must resolve that ID through its own local registry and enforce any additional confirmation policy.

The local CLI can grant, check, list and revoke permissions over authenticated Unix IPC. A grant requires an existing trusted peer and can have an RFC3339 expiration. A foreign key deletes all grants when the corresponding trust record is removed. Grant creation, expiration changes and revocation are audited in the same SQLite transaction. Audit history is local and bounds retention to the most recent 1,000 permission changes per device identity. The CLI displays up to 100 events newest first. Expiration is enforced during checks, and an expired rule remains visible for inspection until it is removed or updated.

Peer operations check permissions against the fingerprint authenticated by TLS. The single-file receiver consumes the exact `file-receive/inbox` grant and independently requires approval of each incoming offer. It rechecks scope and permission during the transfer and before publishing. The Bridge receiver consumes the exact `service-connect` grant for a registered loopback target. It closes active forwarding when scope or permission lapses.

[Live Resource Mount](../protocols/mount.md) uses `folder-mount` grants for individual directory exports. The export's read-only setting applies even when a peer holds a valid grant. [Bluetooth + Wi-Fi P2P](../protocols/nearby.md) changes how a peer is reached. Resource requests still use the peer identity verified by TLS and the same grant checks.

[Folder Sync](../protocols/sync.md) requires a `folder-sync` grant for the folder ID. The configured sync mode determines which direction files can travel.

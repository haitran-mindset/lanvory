# Live Resource Mount

A device can export a local directory and grant a paired peer access to that specific export. The client connects through a loopback WebDAV proxy. The peer connection uses the `lanvory-mount/1` ALPN with mutually authenticated TLS, or the corresponding QUIC stream when available. The client's local proxy is reachable by processes on the same computer.

## Authorization and filesystem scope

- The host identifies the peer by its authenticated Ed25519 fingerprint. Resource discovery lists exports visible to that peer. Resource requests require the exact `folder-mount` grant and an active export with the requested ID.
- Read-only exports reject write operations. Read/write exports permit supported WebDAV operations such as uploading, creating directories, moving and deleting files inside the shared directory.
- The host scopes requests to the exported directory and rejects traversal outside the export and symlink paths. HTTP Range requests can read portions of a file.
- The host checks access on requests and rejects requests after the grant expires or is revoked. A client that receives a revocation event marks the session revoked. Copies already obtained by the recipient remain in their possession.

See [Peer resource permissions](../security/permissions.md) and the [threat model](../security/threat-model.md).

# Threat model

Treat LAN observers and peers, advertised metadata, renderer input and remote file metadata as hostile. The local OS account and the daemon process are the initial trusted computing base. Other local accounts must not access the daemon socket or key material. Same-account malware and privileged OS compromise are outside the isolation provided by an owner-only Unix socket.

- The daemon stores the long-term Ed25519 identity seed in an owner-only file inside its private state directory. It exposes the public key or fingerprint for identity verification.
- Bind listeners only to explicitly approved LAN interfaces. Validate current interface address and on-link prefix before connecting. Private IP membership alone grants no access.
- Confirmed pairing requires pinning the receiver fingerprint, checking the TLS-derived code over a trusted channel, and approving on both devices. The manual bootstrap verifies the other key independently on each device. Permissions default to deny and are enforced in the daemon. Revocation must also close existing privileged sessions.
- Require approval before incoming files are written. Constrain paths under the approved destination, resist symlink escapes and bound bytes, deadlines and concurrency.
- Bind local service proxies to loopback and authorize individual services. Peers may request a service ID and cannot select an arbitrary destination address.

## Nearby discovery and direct Wi-Fi

Treat BLE labels, service names, and advertised identifiers as untrusted discovery data. Advertising makes the device label visible to nearby observers. Wi-Fi P2P uses the macOS helper and a local loopback bridge, with peer authentication and authorization enforced by Lanvory over TLS. A reachable service or a fingerprint learned by probing it does not establish trust. See [nearby discovery](../protocols/nearby.md) and [pairing](../protocols/pairing.md).

## Remote folder access

Live Resource Mount authorizes individual exports for an authenticated peer. A read/write export permits that peer to modify or delete files inside the approved directory. Read-only exports reject writes, and the host rejects traversal and symlink paths. Revocation denies subsequent requests. See the [mount protocol](../protocols/mount.md) for details and the client loopback boundary.

## Folder synchronization

Folder Sync checks a per-peer folder grant before accepting the session and verifies incoming bytes against the SHA-256 digest. Modification times select transfer direction in bidirectional mode, and conflict copies are best effort. See the [sync protocol](../protocols/sync.md) for scope and failure behavior.

## Screen Sharing

A saved trust relationship allows a peer to send an invitation. The viewer must accept before the daemon will expose frames. The sender grants macOS capture access, selects a source, and confirms the local preview. Scoped mutual TLS authenticates peer requests. Frame size and dimensions are bounded, and the receiver keeps the latest frame in memory. The viewer can still copy visible material using OS tools. See the [Screen Sharing protocol](../protocols/screen-sharing.md).

## Release distribution

The packaged macOS app checks the public GitHub Releases endpoint for a newer stable tag. It checks the expected asset name and URL for the running architecture and opens the download in the browser after the user chooses **Download update**. The user installs the DMG manually.

The notification does not verify a downloaded DMG or replace the running app. Ad-hoc signing has a different trust model from Developer ID signing and Apple notarization. See [macOS packaging and distribution](../deployment/macos.md).

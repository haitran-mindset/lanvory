# Threat model

Treat LAN observers and peers, advertised metadata, renderer input and remote file metadata as hostile. The local OS account and the daemon process are the initial trusted computing base. Other local accounts must not access the daemon socket or key material. Same-account malware and privileged OS compromise are outside the isolation provided by an owner-only Unix socket.

- Keep the long-term Ed25519 key in the OS credential store. Export only the public key or its fingerprint.
- Bind listeners only to explicitly approved LAN interfaces. Validate current interface address and on-link prefix before connecting. Private IP membership alone grants no access.
- Confirmed pairing requires pinning the receiver fingerprint, checking the TLS-derived code over a trusted channel, and approving on both devices. The manual bootstrap verifies the other key independently on each device. Permissions default to deny and are enforced in the daemon. Revocation must also close existing privileged sessions.
- Require approval before incoming files are written. Constrain paths under the approved destination, resist symlink escapes and bound bytes, deadlines and concurrency.
- Bind local service proxies to loopback and authorize individual services. Peers may request a service ID and cannot select an arbitrary destination address.

# Experimental macOS peer listener

A daemon started with both `--peer-interface` and `--peer-bind` can bind one IPv4 TCP socket. Startup requires that the named interface is current, approved, and owns the exact private or link-local address. The socket sets Darwin `IP_BOUND_IF` before binding. No wildcard address or platform fallback is used.

The listener rechecks stored approval and the current interface before each TLS handshake and once per second while idle. It closes on lost scope and stays closed until the daemon is restarted explicitly. It limits concurrent handshake handlers to 16 and limits each TLS handshake to two seconds. The local control socket remains available after peer listener closure.

The experimental ALPN identifier is `lanvory-identity/1`. The TLS 1.3 handshake proves possession of the same persistent Ed25519 key used for the local fingerprint. The self-signed certificate is not a trust grant. Clients need a separately verified Ed25519 pin. The one-way identity protocol sends no application data and does not authenticate clients. The separately negotiated trusted protocol performs mutual identity verification. Bonjour publication remains opt-in. Two-device validation remains open.

## Opt-in Bonjour publication

Add `--peer-advertise` to register `_lanvory._tcp.local.` on the listener's bound interface index and port. Each daemon start generates a random instance label and sends an empty TXT record. Bonjour uses the OS's local hostname as the SRV target, which becomes visible to observers on the local link. The existing Ed25519 identity stays in TLS.

The daemon couples the registration and peer socket lifetimes. Loss of the listener or approval cancels publication and frees the Bonjour reference. Registration failure closes the peer socket. The local control daemon remains available. Bonjour confirmation is surfaced separately from socket startup.

A cache may retain the service briefly after deregistration. Discovery snapshots represent observations, while the listener independently closes and enforces local approval. See [RFC 6762 §10.1](https://www.rfc-editor.org/rfc/rfc6762.html#section-10.1).


## Outbound verification

`lanvory peer verify` accepts an explicit IPv4 endpoint and an independently obtained SHA-256 fingerprint of the remote Ed25519 key. The daemon checks the current interface approval and subnet, binds the TCP socket to the selected source address and interface with `IP_BOUND_IF`, and checks the scope again once the handshake finishes. It does not fall back to an unbound socket or resolve a hostname.

The client requires TLS 1.3 and `lanvory-identity/1`. Go's `VerifyConnection` callback requires the Ed25519 public key hash to match the supplied pin and checks the certificate validity interval. This replaces public CA and hostname validation for the self-signed peer identity. The connection is closed after authentication. [Go crypto/tls documentation](https://pkg.go.dev/crypto/tls)

## Mutual trust verification

Each daemon owns a trust table scoped to its current local device identity. An explicit `peer trust` command saves a peer only after a scoped TLS handshake proves possession of the independently obtained fingerprint. Plain verification never persists trust. Repeated approval preserves the original timestamp. Revocation removes the local approval. A fresh device identity starts with an empty list.

`peer verify-trusted` requires the selected fingerprint to be saved locally. It offers only the `lanvory-trusted/1` ALPN. The server requires a client certificate and verifies the Ed25519 key against its own trust table. It rechecks scope and approval before sending a one-byte acceptance marker. The client authenticates the server fingerprint and waits for that marker, since completion of the client side of the TLS 1.3 handshake alone does not establish server acceptance. Both sides close after verification. The trusted verification ALPN exposes no resource operations. [Single-file transfer](drop.md) uses its own authenticated ALPN and inbox permission.

The bootstrap flow uses independently exchanged fingerprints and two explicit local approvals. The optional inbound pairing ALPN adds two explicit confirmations using a TLS-derived hexadecimal code. QR exchange remains open. See [pairing](pairing.md).

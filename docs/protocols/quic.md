# QUIC mutual identity verification

Run the opt-in peer listener with `--peer-quic` to add a UDP listener on the same approved IPv4 address and numeric port as TCP. With `--peer-advertise`, Bonjour publishes both TCP and UDP records using the same instance label. Use `discover resolve INTERFACE "INSTANCE" udp` to resolve the UDP record.

The daemon uses [quic-go](https://github.com/quic-go/quic-go/releases/tag/v0.65.0) with TLS 1.3, the Ed25519 identity certificate, the stored peer fingerprint and ALPN `lanvory-quic-trusted/1`. The client pins the remote key and the server verifies the client certificate against its own trust store. The regular QUIC listener and dialer run without 0-RTT. Servers require source address verification and accept no unidirectional streams. The bound listener accepts up to four concurrent bidirectional streams per connection. The negotiated ALPN selects identity verification, Drop or Bridge.

The macOS socket sets `IP_BOUND_IF` and binds the selected IPv4 address explicitly. The packet adapter filters inbound source and outbound destination addresses against the approved link inventory. The client pins its UDP peer address and port. The server verifies the original peer endpoint, fresh scope and trust before replying to each stream. It refreshes policy on a timer and closes when scope is revoked.

`lanvory peer verify-trusted` tries QUIC first and falls back to the existing pinned mutual TCP protocol only when the QUIC dial times out before completing the handshake. Authentication, application protocol and scope failures are terminal for the request. `lanvory peer verify-quic` requires QUIC and exposes a verification path for physical LAN tests.

Drop and Bridge prefer QUIC with the same timeout-only fallback rule before opening an application stream. Both reuse the same authenticated receive and forwarding logic as TCP. A permission failure, declined offer or broken stream never triggers an automatic resend or reopen over TCP. QUIC sessions use a 60-second idle timeout and a 15-second keepalive period to cover the file approval window. A stream supports deadline, cancellation and a graceful write half-close. The daemon keeps application operations on demand. Connection pooling across separate client operations and two-device LAN verification remain open.

The packet filter currently uses the generic Go packet interface. quic-go reports that this wrapper cannot tune UDP buffers automatically. Throughput testing and tuning remain open.

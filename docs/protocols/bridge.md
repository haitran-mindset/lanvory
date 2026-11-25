# Lanvory Bridge service endpoint

The owner registers a resource ID and literal TCP loopback address over authenticated Unix IPC. The target has to be in IPv4 loopback or be `::1`. The peer can request the resource ID only. It cannot send a host, port, URL or credentials to the forwarding code. Underlying application authentication remains in effect.

The daemon presents `lanvory-bridge/1` over the approved-interface TLS listener. Both Ed25519 identities are verified before any bridge request is accepted. The request is a one-byte length followed by up to 64 bytes of lowercase service ID. The receiver checks its current interface scope, registry, trust and exact `service-connect` grant before opening the registered loopback socket. Byte `1` acknowledges connection establishment. Subsequent bytes are relayed over that single TCP connection.

A grant requires an existing registered service. Registry removal and grant removal run in one SQLite transaction. Reusing an ID for another target requires removing the service and explicitly granting access again. Older grants created without a registered target remain visible and inactive until explicitly renewed. Other grants and trusted peers are preserved.

Active service sessions recheck scope and authorization every 500 milliseconds and close the service-side connection on revocation, removal, expiration or adapter change. When adapter approval is revoked, the QUIC packet filter also blocks outbound packets, including the termination notification. The remote tunnel client may therefore learn that its connection closed through the QUIC idle timeout instead. Each session lasts at most 30 minutes and is bounded by the peer listener's concurrent connection limit. The protocol sends no target address back to the peer. Physical LAN verification remains open.

## Client tunnel

`lanvory tunnels open` explicitly selects an approved adapter, on-link remote IPv4 endpoint, previously trusted fingerprint, service ID and local loopback bind. The default bind is `127.0.0.1:0`, which allocates a port on the local machine. Opening the listener performs local policy checks. Each local connection then initiates its own pinned mTLS handshake and waits for the remote service acceptance byte before forwarding. Therefore a listening tunnel does not guarantee that the remote service is available.

The local listener never binds a wildcard or non-loopback address. Other local processes can connect to it, so application-level authentication remains necessary where appropriate. The daemon limits tunnels to eight, with up to four local streams each. It closes listeners and sessions when local trust or the original interface scope is lost, when the owner stops a tunnel, or when the daemon exits. The remote daemon independently enforces service registration, permissions and expiration. Tunnel listeners are session state and must be explicitly reopened after a restart.

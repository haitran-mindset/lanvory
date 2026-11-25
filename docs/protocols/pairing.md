# Confirmed peer pairing

The receiver enables incoming requests when starting its approved IPv4 listener with `--peer-pairing`. The initiator supplies the receiver fingerprint obtained over a trusted channel. The scoped TCP connection uses TLS 1.3, pinned receiver identity, a client proof of possession of an Ed25519 key, and dedicated ALPN `lanvory-pair/1`. The initial client key has access only to the pairing protocol.

Both peers derive the same 128-bit confirmation value from the live TLS session with the exporter label `EXPORTER-Lanvory-Pairing-v1`. The value is displayed locally as four hexadecimal groups. Users compare the entire value over an independent channel and enter the other device's value into their own pairing dialog. The code itself is not sent in the pairing messages. Each connection exchanges a one-byte approval marker and then a one-byte persistence receipt.

A daemon saves the remote fingerprint only after both approvals arrive and its network scope still permits the connection. Success requires the peer's receipt. A connection loss after both approvals can leave trust saved on one side while the initiating command reports failure. Repeating the confirmed pairing is safe. Peer keys are indexed by fingerprint, and a different key needs its own approval. The trust entry adds no resource grants.

Pending requests expire after 60 seconds, with at most eight requests and one pending request per fingerprint. Incoming requests also have a ten-second cooldown per source. A third incorrect code or a declined request cancels the session. An approval consumes the local request ID, and a new session gets a different TLS exporter value. Revoking trust also cancels pending requests for that fingerprint.

In Devices, scan Nearby services and choose Pair on a TCP result to prefill the approved adapter and select a resolved IPv4 endpoint. On the receiving device, open My device and choose Copy device ID. Exchange it over an independent trusted channel. Manual endpoint entry is also available. QR transport and cross-device validation remain open.

The initiating desktop can use Cancel pairing request to stop waiting before or after the confirmation code appears. If both devices already approved, check Trusted peers for a saved key. Use Decline for an incoming request. The receiver continues reading after the initiator approves so it can remove the pending request on disconnect while local consent is still pending.

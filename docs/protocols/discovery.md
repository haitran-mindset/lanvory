# Discovery snapshot on macOS

The CLI `lanvory discover` and Devices → Nearby services → Scan request a one-shot browse. The daemon loads the approval table and enumerates current interfaces under the same lock used for approval writes. An adapter must still match the saved approval and pass eligibility checks. The daemon admits one scan at a time.

The macOS backend uses [DNSServiceBrowse](https://developer.apple.com/documentation/dnssd/dnsservicebrowse%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29?language=objc) for both `_lanvory._tcp` and `_lanvory._udp` in `local.` with an explicit interface index. It filters callbacks by index and domain, samples for 750 milliseconds per service type, caps results at eight instances per service type per interface and closes all browse handles before returning. Scans support up to eight eligible approved interfaces at once. With zero eligible approved interfaces the response is empty and Bonjour is never called.

The result is a transient snapshot of unverified service names, transport and the receiving interface. The app does not treat a service name as a device identity, or resolve or dial the advertised endpoint. The experimental peer listener can explicitly publish its TCP service. The CLI can resolve a TCP or UDP result as described below. Validation across devices remains open.

## Scoped service resolution

`lanvory discover resolve INTERFACE "INSTANCE"` resolves the TCP instance by default. Append `udp` to resolve the UDP instance in `local.` on the named active approved adapter. Bonjour uses multicast-only SRV and A queries on the same explicit interface index. The resolver accepts a local SRV hostname and nonzero port, ignores TXT and IPv6 data, bounds each query phase to 850 milliseconds, and collects up to eight distinct IPv4 records. [Apple DNSServiceResolve](https://developer.apple.com/documentation/dnssd/dnsserviceresolve%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29?language=objc) · [Apple DNSServiceQueryRecord](https://developer.apple.com/documentation/dnssd/dnsservicequeryrecord%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29)

The daemon checks interface approval before and after the lookup and filters addresses against current LAN scope. Off-subnet, reserved and same-host addresses cannot become endpoints. A valid response can have an empty endpoint list. Resolution opens no peer socket and creates no trust. Clients must enforce scope again at dial time and verify the pinned TLS key separately.

## Bluetooth + Wi-Fi P2P (AWDL) nearby discovery on macOS

When the user enables **Bluetooth + P2P** in the desktop sidebar (or via `lanvory nearby start`), the macOS daemon launches `lanvory-nearby` (`core/native/darwin/lanvory-nearby.swift`). The helper uses CoreBluetooth for BLE advertising/scanning and `Network.framework` (`includePeerToPeer = true`) for Apple Wireless Direct Link (AWDL) peer-to-peer Wi-Fi discovery and transport.

- **Routerless operation**: Nearby Macs can discover and connect to each other even when no shared Wi-Fi router or Ethernet network is present, or when a guest Wi-Fi network isolates LAN clients.
- **Explicit user control**: Bluetooth + P2P is off by default and gated by macOS `NSBluetoothAlwaysUsageDescription` and explicit user activation (`lanvory nearby start` / `stop`).
- **Untrusted until paired**: Discovered BLE/P2P peers still require pinned Ed25519 verification and mutual pairing confirmation before gaining trust or resource access.

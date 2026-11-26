# LAN discovery on macOS

The CLI `lanvory discover` and Devices → Nearby services → Scan request a one-shot browse. The daemon loads the approval table and enumerates current interfaces under the same lock used for approval writes. An adapter must still match the saved approval and pass eligibility checks. The daemon admits one scan at a time.

The macOS backend uses [DNSServiceBrowse](https://developer.apple.com/documentation/dnssd/dnsservicebrowse%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29?language=objc) for both `_lanvory._tcp` and `_lanvory._udp` in `local.` with an explicit interface index. It filters callbacks by index and domain, samples for 750 milliseconds per service type, caps results at eight instances per service type per interface and closes all browse handles before returning. Scans support up to eight eligible approved interfaces at once. With zero eligible approved interfaces the response is empty and Bonjour is never called.

The result is a transient snapshot of unverified service names, transport and the receiving interface. Scanning alone neither resolves nor dials an advertised endpoint. An explicit pairing action can resolve a selected result. The LAN listener can publish TCP and, when enabled, QUIC over UDP. Validation across devices remains open.

## Scoped service resolution

`lanvory discover resolve INTERFACE "INSTANCE"` resolves the TCP instance by default. Append `udp` to resolve the UDP instance in `local.` on the named active approved adapter. Bonjour uses multicast-only SRV and A queries on the same explicit interface index. The resolver accepts a local SRV hostname and nonzero port, ignores TXT and IPv6 data, bounds each query phase to 850 milliseconds, and collects up to eight distinct IPv4 records. [Apple DNSServiceResolve](https://developer.apple.com/documentation/dnssd/dnsserviceresolve%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29?language=objc) · [Apple DNSServiceQueryRecord](https://developer.apple.com/documentation/dnssd/dnsservicequeryrecord%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29)

The daemon checks interface approval before and after the lookup and filters addresses against current LAN scope. Off-subnet, reserved and same-host addresses cannot become endpoints. A valid response can have an empty endpoint list. Resolution opens no peer socket and creates no trust. Clients must enforce scope again at dial time and verify the pinned TLS key separately.

## Nearby discovery without a shared LAN

See [Bluetooth and Wi-Fi peer-to-peer on macOS](nearby.md) for the CoreBluetooth and AWDL path. Both discovery paths return candidates that must be verified during [pairing](pairing.md).

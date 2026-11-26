# Bluetooth and Wi-Fi peer-to-peer on macOS

Lanvory can discover nearby Macs and establish a direct Wi-Fi connection without a shared access point. CoreBluetooth handles Bluetooth Low Energy (BLE) discovery. Apple Network.framework, with peer-to-peer networking enabled, handles service discovery and the TCP connection over Apple's peer-to-peer Wi-Fi transport (AWDL). File data travels over the Wi-Fi connection.

## Discover and connect

1. Enable **Bluetooth + P2P** in Lanvory and allow the system permissions when prompted.
2. Make the receiving Mac **Discoverable**. The native helper advertises a BLE service and a `_lanvory-p2p._tcp` service. A nearby observer may see the advertised device label and short tag.
3. Scan from the other Mac and select a device with a Wi-Fi P2P service. The helper opens a local loopback bridge to that service. A Bluetooth result alone does not establish the Wi-Fi connection.
4. Pair the devices by verifying the peer identity and confirming on both sides. Once paired, the resource you use still needs its own permission. See [Confirmed peer pairing](pairing.md) and [Peer resource permissions](../security/permissions.md).

The helper forwards TCP bytes to the daemon's loopback listener. Lanvory terminates TLS at the two daemons, so the helper does not establish peer trust. The identity probe learns the fingerprint presented by the remote daemon. For a new peer, treat the result as a candidate and compare the pairing details on both physical devices. Daemon-side P2P pairing and resource loopback operations (file transfer, shared clipboard, folder sync, service tunnels, and live mounts) accept only an endpoint registered by the local helper (`HasEndpoint`) during the active session; ephemeral `127.0.0.1:<port>` P2P routes are not persisted across desktop restarts.

## CLI and limits

```sh
lanvory nearby status
lanvory nearby advertise on
lanvory nearby scan
lanvory nearby connect "SERVICE_NAME"
lanvory nearby advertise off
```

Bluetooth permissions, continued peer visibility, and a functioning Wi-Fi P2P link affect availability. [LAN discovery](discovery.md) has separate adapter approval and address scope rules. See the [threat model](../security/threat-model.md) and [physical validation runbook](../development/lan-validation.md).

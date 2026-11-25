# Lanvory

Lanvory is a local-first desktop network platform under development. See [HANDOFF.md](HANDOFF.md) for the current scope and validation.

## Go daemon and CLI

Use macOS with a C toolchain and Go 1.26 or later. From the repository root:

```sh
cd core
go build -o ../bin/lanvoryd ./cmd/lanvoryd
go build -o ../bin/lanvory ./cmd/lanvory
../bin/lanvoryd
```

From another shell, run `./bin/lanvory identity` in the repository root. The daemon stores the Ed25519 seed in `~/.lanvory/identity.key` (`0600`). The owner-only socket and the SQLite file with public device profile metadata also live under `~/.lanvory`. Run `./bin/lanvory network` while the daemon is running to inspect local interfaces and CIDR addresses. Stop the foreground daemon with Ctrl+C.

Run `./bin/lanvory status` to inspect daemon health, local listener status, and trusted peer/service counts, or `./bin/lanvory doctor` to verify local directories, database integrity, and system readiness. Append `--json` for structured output.

```sh
cd core
go test -race ./...
go vet ./...
```

For daemon and CLI development on Linux, install a C toolchain and SQLite development headers (`libsqlite3-dev` on Debian/Ubuntu). Use the same Go build commands. The daemon stores the Ed25519 seed in `~/.lanvory/identity.key` with owner-only (`0600`) permissions. TCP and QUIC require a kernel that supports `SO_BINDTOIFINDEX`. The Linux `network listener start` command opens the listener for manual connections by address. LAN discovery and desktop packaging remain pending on Linux.

## Desktop development build

Install Node.js 22.12 or later and pnpm 12.5.1. Build both Go binaries into `bin/` first, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm desktop
```

Launch from an interactive macOS session. The desktop starts the daemon when needed and reuses an already running local instance. The Devices view shows the local identity and fingerprint. Network shows the current OS interface inventory on demand. Settings saves your device name locally. The same change is available with `./bin/lanvory identity rename "My device"`. The name is stored in SQLite and kept out of Bonjour announcements. Settings also stores the theme and text size in the Electron profile. Choose System to follow macOS appearance changes.

The Electron launcher initializes its pinned binary on first use if needed. Run `pnpm --filter @lanvory/desktop exec electron --version` while online to prepare a development checkout before offline testing. The packaged app already includes the Electron runtime.

To verify identity persistence and process locking, quit the desktop and stop any standalone daemon, then run `sh scripts/smoke-identity.sh` from an interactive session.

After installing dependencies, `make build` builds the Go binaries and renderer. `make verify` runs type checks, Go vet, race tests and script syntax checks.


### LAN adapter approval

In Network, select your network and choose **Turn on LAN**. Lanvory approves the selected adapter and starts the listener. **Turn off LAN** stops the listener and revokes that adapter’s approval. For manual control, open **Advanced options → Network adapters** and use **Approve** or **Revoke**. The same approval controls are available through the CLI.

```sh
./bin/lanvory network
./bin/lanvory network approve en0
./bin/lanvory network revoke en0
```

Replace `en0` with the interface you intend to use. The CLI rejects loopback, point-to-point, down and public-only adapters for approval. With an approved adapter, click **Scan** under Devices or run:

```sh
./bin/lanvory discover
```

macOS Bonjour browses `_lanvory._tcp.local.` and `_lanvory._udp.local.` on demand and displays unverified service instance names and transport. The scan does not resolve or dial endpoints.

On builds without automatic discovery, `discover` returns `unavailable: true` and lists the eligible approved adapters under `interfaces`. Use the other device's address and independently obtained device ID to pair manually.


### Check an endpoint's LAN scope

```sh
./bin/lanvory network check en0 192.168.1.42
```

Use an IPv4 literal and the adapter name. The command prints a JSON decision. If the address passes, the result includes the matching local source and subnet. A denied decision includes a reason. Either decision returns exit status 0, while invalid arguments and IPC errors return a nonzero status. This check uses local interface data and sends no packets. Reachability and socket routing are outside this check.


### Experimental peer identity listener on macOS

The desktop Network view can approve an IPv4 adapter and start TCP, QUIC and incoming pairing for the daemon session. On macOS, the native build also advertises the listener over Bonjour. In the CLI, first run `./bin/lanvory network approve INTERFACE`, then run `./bin/lanvory network listener start INTERFACE IPv4:PORT`. Append `--no-pairing` to accept only already trusted peers. Run `./bin/lanvory network listener stop` to stop accepting connections and withdraw any publication while keeping local IPC running.

From an interactive macOS session, approve the intended adapter through a running daemon. Stop that instance, then run:

```sh
./bin/lanvoryd --peer-interface en0 --peer-bind 192.168.1.20:0
```

Use an IPv4 address assigned to the adapter. Port `0` requests an ephemeral port, which the daemon reports at startup. The listener uses TLS 1.3 with a self-signed Ed25519 identity certificate and serves no application protocol after the handshake. A client must already know the expected device key to verify its identity. The default daemon and Electron startup leave the listener disabled.

Add `--peer-advertise` to the listener command to publish its port on the approved link. Bonjour uses the OS local hostname as the SRV target. Registration is optional and ends with the listener.


### Resolve a discovered TCP service

```sh
./bin/lanvory discover
./bin/lanvory discover resolve en0 'Lanvory INSTANCE'
```

Use the interface and exact service name from a TCP result. The daemon resolves SRV and A records through multicast DNS on that adapter. It returns IPv4 endpoints that pass current subnet and approval checks, plus the number of rejected addresses. A result is discovery data. Establish identity by verifying a separately obtained key during TLS.


### Verify a peer's Ed25519 identity

On the peer, read the fingerprint using `./bin/lanvory identity fingerprint` and transfer it over a trusted channel. With the peer TLS listener running and your own adapter approved:

```sh
./bin/lanvory peer verify en0 192.168.1.42:43110 "$peer_fingerprint"
```

Set `peer_fingerprint` to the 64-character hex fingerprint from that trusted channel. Replace the adapter and endpoint with the values for your LAN. Verification closes the connection after the handshake. It does not pair the devices or grant access.

To test an authenticated TLS connection and measure round-trip latency (RTT) without exchanging data:

```sh
./bin/lanvory peer ping en0 192.168.1.42:43110 "$peer_fingerprint"
./bin/lanvory peer ping en0 192.168.1.42:43110 "$peer_fingerprint" --json
```


### Save and revoke a peer approval

After exchanging fingerprints over a trusted channel, use Devices → Trusted peers → Add trusted peer on each device, or run the CLI commands below with the other device's endpoint and fingerprint:

```sh
./bin/lanvory peer trust en0 192.168.1.42:43110 "$peer_fingerprint"
./bin/lanvory peer trusted
./bin/lanvory peer verify-trusted en0 192.168.1.42:43110 "$peer_fingerprint"
./bin/lanvory peer revoke "$peer_fingerprint"
```

The first command verifies the remote key before saving it. Mutual verification requires each device to trust the other's fingerprint. Revocation takes effect for new verification attempts. See the [two-device validation procedure](docs/development/lan-validation.md).


### Manage per-resource peer permissions

```sh
./bin/lanvory permissions grant "$peer_fingerprint" file-receive inbox "$expires_at"
./bin/lanvory permissions check "$peer_fingerprint" file-receive inbox
./bin/lanvory permissions list
./bin/lanvory permissions revoke "$peer_fingerprint" file-receive inbox
./bin/lanvory permissions audit
```

Set `expires_at` to a future RFC3339 timestamp, or omit it for a grant that remains until revoked. The peer must already be trusted. These commands configure policy only. See [resource permissions](docs/security/permissions.md) for supported capabilities and the current integration status.


### Send a single file

On both devices, establish mutual trust and run the opt-in peer listener on the receiving device. On the receiver, grant the trusted sender access under **Sharing → Inbox access**, or use the CLI:

```sh
./bin/lanvory permissions grant "$sender_fingerprint" file-receive inbox
```

On the sender, run:

```sh
./bin/lanvory files send en0 192.168.1.42:43110 "$receiver_fingerprint" ./example.txt
```

While the sender waits, use a second terminal on the receiver:

```sh
./bin/lanvory files incoming
./bin/lanvory files approve "$offer_id"
```

Use `files decline "$offer_id"` to reject the offer. Completed files appear under `~/.lanvory/inbox`. Existing files are preserved. The sender waits for the receiver to confirm integrity. See [Drop protocol and limits](docs/protocols/drop.md).


### Sharing in Electron

Use **Sharing → Send a file** to select one local file with the native picker, then enter the approved adapter, peer endpoint and saved peer fingerprint. The receiver can approve or decline pending offers from the same view. During transfers, Sharing displays the byte count and state. Use **Cancel send** to stop an outgoing desktop transfer.

`./bin/lanvory files transfers` returns the same activity as JSON. The latest 100 finished transfers for the current device identity persist locally. Active transfers exist in memory and end if the daemon stops.


### Register a local TCP service

On the machine hosting the service, choose a resource ID and an existing loopback target:

```sh
./bin/lanvory services share notes 127.0.0.1:8080
./bin/lanvory permissions grant "$peer_fingerprint" service-connect notes
./bin/lanvory services list
./bin/lanvory services remove notes
```

A peer needs a separate grant for each service. Removing a service revokes its grants. Use a client tunnel on the other device to reach the registered service. See [Bridge protocol and limits](docs/protocols/bridge.md).

### Open a local client tunnel

On the client, approve its LAN adapter and save the hosting peer's verified fingerprint. With the host listener running and the service grant in place:

```sh
./bin/lanvory tunnels open en0 192.168.1.42:43110 "$peer_fingerprint" notes
./bin/lanvory tunnels list
./bin/lanvory tunnels stop "$tunnel_id"
```

Point your browser or client at the `bind` address returned by `tunnels open`. Each request uses the existing protocol of the registered TCP service. Supply an optional final value such as `127.0.0.1:18080` to choose a local port. The client loopback listener is available to other processes on that machine and does not change the service's own authentication.


In Electron, use **Services** to register a loopback target, grant or revoke a trusted peer's access, and open or stop local tunnels. The tunnel card shows the bound address and active connection count.


### Build a macOS app or DMG

```sh
make package-macos
make dmg-macos
```

The bundle includes the Go daemon and CLI. The default ad hoc package is intended for local testing. See [macOS packaging](docs/deployment/macos.md) for output paths, verified Electron archives and Developer ID release steps.


### macOS menu bar

The Lanvory menu bar item shows daemon status, reopens the window, retries a failed daemon connection and quits the desktop app. Closing the window hides it while activity can continue. Quitting stops the daemon started by that desktop process. A daemon started separately remains running.

Use `make smoke-native` to exercise native window and daemon ownership behavior with isolated local state on macOS.


### Verify a trusted peer over QUIC

Start the remote daemon with its existing peer interface and bind address, plus `--peer-quic`:

```sh
./bin/lanvoryd --peer-interface en0 --peer-bind 192.168.1.42:43110 --peer-quic
./bin/lanvory peer verify-quic en0 192.168.1.42:43110 "$peer_fingerprint"
```

The first command runs on the hosting device. The second runs on the other device, with its own approved interface name and the host fingerprint saved. Both peers must have saved trust. `peer verify-trusted` prefers QUIC with TCP fallback on handshake timeout. Drop and Bridge use the same transport preference. Add `--peer-advertise` to also publish Bonjour UDP. See the [QUIC protocol notes](docs/protocols/quic.md).


### Confirm pairing on both devices

Enable incoming pairing on the receiving daemon with `--peer-pairing` in addition to its approved interface and bind address. Get its fingerprint over a trusted channel. Use **Devices → Pairing** or start pairing from the other machine:

```sh
./bin/lanvory peer pair en0 192.168.1.42:43110 "$peer_fingerprint"
```

While the command waits, inspect `./bin/lanvory pairing list` on both devices. Compare the full code over an independent channel. On each device, use the local request ID and the code shown on the other device:

```sh
./bin/lanvory pairing approve "$request_id" "$other_device_code"
```

Use `pairing decline "$request_id"` to stop a pending request. See [pairing protocol](docs/protocols/pairing.md) for expiration and trust persistence behavior.

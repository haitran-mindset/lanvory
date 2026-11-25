# Handoff

## Current phase

MVP implementation and acceptance target macOS on Apple Silicon using the existing Go daemon and Electron desktop application. Prior Linux core and Rosetta results remain regression evidence for their recorded environments. Native Intel and Linux desktop acceptance are POST_MVP. Windows desktop is FUTURE.
Phase 1 has a verified macOS vertical slice. Phase 1 as a whole remains open for editable local settings, richer daemon lifecycle, structured events, and complete acceptance checks. An on-demand Bonjour browse has been implemented and exercised on one macOS host. End-to-end peer discovery across physical devices remains open.

## Implemented and exercised

- Go daemon with macOS Keychain-backed Ed25519 identity, Unix-socket IPC v1 with effective UID verification in both directions, instance locking and graceful shutdown after initialization.
- SQLite schema v2 persists explicit LAN adapter approvals in addition to public device profile metadata.
- Authenticated CLI commands approve and revoke a LAN adapter. Desktop Network shows approval and eligibility after refresh. Neither command modifies OS network settings.
- CLI subcommands for identity JSON, fingerprint, and local interface inventory. Electron Devices and Network views use live daemon responses. Network Refresh enumerates OS interfaces locally.
- Electron uses context isolation, a sandboxed renderer, a restricted preload and current-frame URL checks. Startup failures show a retry action and repeated status polling is read-only.

## Verification on macOS arm64

- Go 1.27.4 was downloaded to a temporary directory and verified against the official SHA-256 checksum. No Go module dependencies are fetched.
- `go test -race ./...` and `go vet ./...` passed. IPC tests exercised a real Unix socket, duplicate instance rejection, network interface enumeration, directory permissions and preservation of a non-socket path. SQLite tests exercised persistence and database-path symlink rejection.
- Both Go binaries built. `sh scripts/smoke-identity.sh` verified stable Keychain identity and fingerprint across two daemon starts and rejection of a duplicate daemon.
- `pnpm typecheck`, `pnpm build` and Electron script syntax checks passed. Vite emitted nonfatal Rollup annotation warnings from Zod.
- Electron was launched and visually inspected. Loopback-only test instrumentation verified the actual device and fingerprint, refreshed the Network inventory and observed the disconnected state after the daemon stopped.
- The smoke test requires an accessible login Keychain. An early run that overrode the home directory failed with OSStatus -60008. The same test passed using the normal login environment.

## Latest interface approval verification

`make verify build` and `sh scripts/smoke-identity.sh` passed on macOS arm64. Added tests cover upgrading schema v1 without changing the device profile, default-deny approvals, persistence, repeated revocation, eligibility checks, and approval requests over a real Unix socket. TypeScript and Vite passed for the Network status changes. The updated Electron view was not re-run in this pass.

## Latest Bonjour verification

`make verify build` passed on macOS arm64. The focused race test with `LANVORY_TEST_BONJOUR_INTERFACE=en0` completed a real `_lanvory._udp.local.` browse on a single temporarily approved interface. Unit tests cover default-deny selection, wildcard exclusion and native backend error propagation. A real Electron window displayed the empty-approval state after clicking Scan. We did not verify a service emitted by a second device.

## Latest endpoint scope verification

`lanvory network check NAME IPv4` evaluates the current approved adapter and IPv4 prefixes without DNS, route lookup, or packet transmission. `make verify build-core` and `sh scripts/smoke-identity.sh` passed on macOS arm64. Tests cover off-subnet private IPs, reserved addresses, inactive approvals, overlapping prefixes, link-local IPv4 and /31 links. The live CLI smoke confirmed the daemon denies the loopback adapter.

## Latest peer listener verification

`make verify build-core` and `sh scripts/smoke-identity.sh` passed on macOS arm64. Tests confirmed a TLS 1.3 handshake with the expected Ed25519 public key in memory, plus a real TCP socket bound to en0 with `IP_BOUND_IF` that closed after test approval was revoked. The real listener test used a temporary key and in-memory approval. A handshake from another device, live publication, and pairing remain unverified.

## Latest Bonjour publication verification

`make verify build` passed on macOS arm64. The opt-in native test opened a TLS peer socket on en0, confirmed the Bonjour TCP registration, found the service from an interface-specific scan, revoked its test approval, and confirmed the advertisement stopped appearing on the second post-revocation scan. The first immediate check had seen a cached record. This was a same-host test. The renderer transport label was type-checked and built but was not exercised in Electron in this pass.

## Latest Bonjour resolution verification

`make verify build-core` and `sh scripts/smoke-identity.sh` passed on macOS arm64. Unit tests cover approval checks before and after resolution, duplicate addresses and rejection of off-link, public, multicast, IPv6 and local addresses. The real Bonjour test on en0 published and browsed a TCP service, resolved its SRV/A data and confirmed the same-host address was excluded. No remote address, TCP dial, or cross-device exchange was verified.

## Latest outbound identity verification

`make verify build-core` and `sh scripts/smoke-identity.sh` passed. Tests exercised the production TLS verifier for matching and incorrect Ed25519 pins and missing ALPN. The CLI smoke confirmed that the daemon rejected verification through loopback before dialing. The production outbound TCP path has not been exercised against a second host. Verification stores no trust and grants no resource access.

## Latest trust and mutual TLS verification

SQLite schema v3 stores verified peer fingerprints under the local identity. Explicit CLI and Electron actions add verified trust, list it and revoke it. The client and listener negotiate a separate trusted ALPN, verify both Ed25519 keys, and require the authenticated server acceptance marker. No resource capabilities are enabled.

`make verify build` and the daemon smoke test passed on macOS arm64. Focused tests exercised migration from schema v2, isolation between device identities, idempotent writes, mandatory verification before a trust write, blocked verification after revocation, and mutual TLS rejection before approval and after revocation. The live Electron trust form reached the actual daemon and displayed the failure for an unapproved adapter. Full peer trust and mutual TLS across two physical devices remain unverified.

## Latest resource permission verification

SQLite schema v4 adds exact per-peer resource grants, optional expiration, and permission audit events. The CLI exposes grant, check, list, revoke and audit. Deleting trust cascades to grants in the same transaction. Focused tests covered migration, denial before grants, scope isolation, expiration and revocation. `make verify build-core` and the real daemon smoke test passed on macOS arm64. No peer resource consumer is enabled yet.

## Latest single-file transfer verification

The daemon and CLI support sending one file, listing incoming offers, and approving or declining them. The receiver checks the authenticated fingerprint and the exact inbox grant, waits for explicit approval, checks free space, streams into a scoped temporary file, verifies SHA-256, and publishes without overwriting. The fixed inbox is `~/.lanvory/inbox`.

`make verify build-core` and the real daemon smoke test passed on macOS arm64. An in-memory mutual TLS transfer exercised both production wire endpoints and confirmed that the file was inaccessible before local approval and matched after commit. Other tests covered denied offers, replayed decisions, reserved filenames, truncation, digest mismatch, cancellation, revocation and symlink collision. The physical LAN transfer remains unverified.

## Latest Sharing verification

Electron Sharing uses a native single-file picker, starts or cancels a send, polls current offers and activity, and can approve or decline an offer. Schema v5 stores the latest 100 finished transfers per local device. Tests verify that active updates are observable, only terminal records persist through a tracker restart, and a successful receive records a completed transfer.

`make verify build-core`, the renderer build, the real daemon smoke test, and the Electron navigation and empty-offer checks passed on macOS arm64. The native picker interaction and offer actions during a cross-device transfer were not exercised in the GUI. The task remains UNVERIFIED until that flow is observed.

## Latest service registry and Bridge receiver verification

SQLite schema v7 persists explicit service IDs and literal loopback targets. Service grants require a registered target. The daemon serves the bridge ALPN only over mutual TLS, looks up the exact resource grant before connecting, and cancels forwarding when authorization or interface scope lapses. Removing a service removes its grants atomically. Pre-existing grants without a registered target remain inactive until renewed.

`make verify build-core` and the real daemon smoke test passed on macOS arm64. The mTLS integration test relayed request and response bytes to a real loopback backend, refused a peer without a grant and disconnected when permission was revoked. A targeted race test passed three repeated runs. Unix socket tests exercised service registration and removal. The built-in client tunnel was implemented in the following slice. The physical LAN test remains open.

## Latest tunnel and Services verification

The daemon manages loopback-only tunnel listeners with pinned mutual TLS, exact remote service IDs, active connection counts, explicit stop and cancellation when local trust or interface scope changes. The daemon retains its Ed25519 key in its own memory for outgoing tunnel handshakes and clears it on shutdown. Electron Services manages loopback service registration, service grants and local tunnels.

`make verify build`, the real daemon smoke test and the Electron Services registration check passed on macOS arm64. The integration test traversed a real local tunnel socket, in-memory mutual TLS and a real loopback backend. It verified byte relay, wildcard rejection, local policy cancellation and explicit listener stop. The earlier Bridge test verifies remote grant revocation. GUI registration was observed and the temporary record was removed. A cross-device tunnel and GUI grant/open/stop interactions remain unverified.

## Latest macOS package verification

Electron Packager builds a self-contained app with the pinned Electron runtime, renderer, Go daemon, CLI and third-party notices. The development build signs ad hoc. The Developer ID branch retains hardened-runtime signing and was not exercised because signing and notarization credentials were unavailable.

`make verify dmg-macos` passed on macOS arm64. After correcting the per-file ad hoc signing options, the DMG checksum and read-only mount were verified. Launching the final mounted app with an isolated state directory started the bundled daemon process; its bundled CLI reached the daemon and Electron showed the live Services view. The pre-existing daemon was left running. The tested DMG is `dist/macos/0.1.0-arm64-uEPoYG/Lanvory-0.1.0-arm64.dmg`.

## Latest macOS native lifecycle verification

The macOS menu bar shows daemon status and exposes Open, Retry and Quit. Native close hides the window, activation restores the same window, and renderer polling pauses while the window is hidden. Quit cancels a desktop send and waits for the daemon it launched. It leaves a pre-existing independent daemon running.

`make verify smoke-native` passed with two separate isolated Electron sessions. The latest mounted, read-only DMG passed checksum and package startup verification with the bundled daemon and CLI. The current locally tested artifact is `dist/macos/0.1.0-arm64-ETETWG/Lanvory-0.1.0-arm64.dmg`. The GitHub Actions workflow parsed as YAML and uses the same local verification and build commands. There was no hosted CI run or Developer ID release in this workspace.

## Latest QUIC verification

quic-go v0.65.0 raises the Go floor to 1.26. The opt-in daemon UDP listener shares the TCP listener's approved IPv4 address and numeric port. The strict CLI path is `peer verify-quic`. `peer verify-trusted` prefers QUIC and falls back to pinned mutual TCP only for pre-handshake UDP timeouts. Resource protocols still use TCP.

`make verify build-core` and isolated daemon smoke tests passed. Focused race tests used real UDP loopback sockets to verify pinned mutual TLS, untrusted key rejection, independent concurrent streams, address filtering and silent-UDP timeout classification. A socket bound to en0 exposed the expected native interface index and closed on fixture revocation. Same-host loopback and bind tests do not establish two-device LAN behavior. The scoped packet wrapper bypasses quic-go's UDP buffer tuning and currently emits its default buffer warning. A newly signed ad hoc app bundle passed signature verification with linked Go module license notices.

## Latest QUIC resource verification

The daemon negotiates Drop and Bridge ALPNs on scoped QUIC. Both reuse the TCP application authorization and cancellation logic through a stream adapter. Drop and Bridge attempt QUIC first and retry TCP only after a pre-application QUIC dial timeout. With advertising enabled the daemon registers a UDP DNS-SD record on the same adapter as TCP. CLI resolution accepts an explicit transport selector.

`make verify build` and an isolated daemon smoke test passed. Native focused race tests used actual UDP loopback to transfer an approved file and relay a loopback service, including closing the relay on grant revocation. Bonjour on en0 confirmed UDP registration, resolution with same-host filtering, and withdrawal. No two-device LAN transfer was observed. Outbound operations remain one on-demand QUIC connection per operation.

## Confirmed pairing

Start the receiving daemon with its approved IPv4 listener and `--peer-pairing`. The initiator pins the receiver fingerprint. Each daemon displays the same TLS-derived code and waits for both approvals before saving the peer key. Go race tests covered actual TLS handshakes in memory, no persistence after a single approval, declined requests, fresh confirmation values, expiry and invalid-code limits. Go vet, TypeScript checks and both builds passed.

The Devices view can resolve a Bonjour TCP scan result and prefill the pairing form. The user provides the fingerprint independently. UDP results remain informational for this TCP pairing protocol. An Electron test with a fixture preload verified TCP-only selection, empty resolution handling, address choice, explicit fingerprint input, and manual fallback. Devices also provides Copy fingerprint for the current local identity. Native smoke intercepted the Electron clipboard call and verified both the exact local fingerprint and rejection of a different fingerprint. Desktop initiators can cancel an outstanding request, including before the code appears. Native smoke verified IPC cancellation and a subsequent request using loopback, which cannot pass daemon scope. A TLS regression test verified cancellation after initiator approval clears both queues without saving trust, including 15 race-enabled runs. The pairing panel shows seconds remaining based on the daemon deadline. An Electron fixture verified the countdown and blocked expired approval before IPC. The macOS desktop checks for pending inbound pairing while hidden and asks the OS to deliver a notification without peer details or codes. Native smoke exercises filtering, grouping and deduplication in the notification policy. Pairing notifications can be turned off in Settings. The preference persists in the Electron profile and is checked before polling and again before notifying. Native smoke verified disabling, reload persistence, and re-enabling. Actual macOS notification delivery and two-device Bonjour pairing remain pending.

## macOS arm64 build with pairing and Settings

The ad hoc image is `dist/macos/0.1.0-arm64-smHPyR/Lanvory-0.1.0-arm64.dmg`. The SHA-256 sidecar verified, the image mounted read-only, and the mounted app passed strict deep signature verification. An initial mounted launch timed out before daemon readiness. The daemon subsequently answered its bundled CLI when launched directly from the image, and a full Electron rerun from a fresh read-only mount started its own bundled daemon and passed the CLI and Pairing, Settings, and Services UI checks. The initial timeout did not recur and its cause remains unknown. The verified image was detached. Automatic launch at macOS login, Developer ID notarization, and two-device LAN checks remain unverified.

## Current macOS arm64 test image

`dist/macos/0.1.0-arm64-DGrydC/Lanvory-0.1.0-arm64.dmg` includes runtime listener control, pairing options and cancellation, and timed Inbox and Bridge grants. The build, SHA-256 sidecar, read-only mount, and strict deep app signature checks passed. On the fresh mounted build, Electron launched its bundled daemon using the login Keychain, the bundled CLI returned identity, and the Pairing, Settings and Services views appeared. The image was detached. Automatic launch at login, release signing and physical two-host behavior remain open. The [two-device runbook](docs/development/lan-validation.md) now follows the runtime listener controls and explicitly tests file denial, approval, checksum and history before revoking trust.

## Local device settings

Settings and `lanvory identity rename NAME` update the device profile over authenticated local IPC. SQLite persists the name without altering the identity key, creation timestamp, or Bonjour label. Names are limited to 63 UTF-8 bytes after trimming and reject control and format characters. The SQLite test reloads the profile and checks owner isolation and invalid names. Native smoke verified the Settings form against both an app-owned and an independently started daemon.

Settings also stores the Default or Large text size in the Electron profile. The Large option scales the root font size to 125% so relative typography follows the preference. Native smoke verifies the computed size before and after a renderer reload in both daemon lifecycle modes. The Electron profile also stores Dark (default), Light, or System. Native smoke verifies both palettes, live system appearance changes, and restoration after reload. Interface density offers Comfortable (default) and Compact. Compact reduces spacing in navigation, device lists, and sharing panels while preserving text size. Native smoke verifies the computed navigation gap and restores the preference after reload. Start minimized stores a flag in the Electron profile. On macOS with the menu bar available, the next launch starts the daemon and leaves the window hidden until activation. Native smoke verified the hidden launch, activation, and saving both enabled and disabled states. Launch at login is exposed only by packaged macOS builds and reads and updates the native login item through Electron. Native smoke confirms source builds cannot register. Registration and a subsequent login with an installed build remain unverified.

## Adapter approval in Network

Network now approves eligible adapters and revokes existing approvals through the authenticated CLI and daemon. Native smoke used an isolated profile to exercise both controls with a real eligible adapter and confirmed the daemon rejects loopback approval. Network also exposes the IPv4 scope diagnostic through the existing daemon policy. It opens no connection. Native smoke verified the unapproved-adapter explanation and invalid IPv4 validation. These tests did not start a LAN listener or exercise another host.

Network also reports the live TCP listener state and pairing availability. Native smoke verifies the local-only display. A separate isolated CLI run verified an actual scoped listener with pairing enabled, followed by the stopped state after adapter approval was revoked. No second peer was involved. Network can also start and stop the listener without restarting the daemon. The action enables Bonjour, TCP, QUIC and incoming pairing for the current daemon session. Go verification passed, a direct CLI run verified start/stop, and an Electron smoke rerun passed in both daemon lifecycle modes. The first smoke attempt timed out at daemon readiness before testing the listener; the subsequent run did not reproduce that startup delay. A follow-up CLI run confirmed separate TCP and UDP Bonjour publication callbacks, active endpoint preservation after duplicate start, shutdown after approval revocation, blocked restart without approval, and a successful second publication after reapproval. The IPC route test verifies invalid input and read-only requests do not start a listener.

Network can start the listener without incoming pairing, while retaining TCP, QUIC and Bonjour. The CLI accepts `--no-pairing` and existing commands keep their prior default. Route tests cover invalid and duplicate options. The macOS controller test opened real TCP and UDP sockets, stopped them, and restarted with pairing disabled using a temporary key. The unmodified daemon blocked in Keychain's `SecItemCopyMatching`; a sampled stack confirmed the blocking call. To isolate the feature, a Go build overlay under a temporary directory replaced only the daemon's startup Keychain read with an ephemeral Ed25519 key. Both native smoke modes passed with the actual Electron renderer, preload, CLI, Unix IPC, and scoped TCP/UDP listener. The smoke restarted the listener with the incoming-pairing checkbox cleared and observed `pairing=false`. The overlay and binaries were kept outside the workspace. Startup of this exact build with the login Keychain and two-host validation remain open. While an app-owned daemon is still starting, the desktop now reports a slow-start status after an eight-second threshold, on the next identity check. The window points to a possible macOS Keychain prompt. An Electron renderer fixture verified the guidance and recovery when identity becomes available. Trusted TLS and QUIC verification and outgoing file sends now reuse the daemon startup key, as pairing and Bridge already did. The macOS IPC regression test uses a temporary key and checks that all three paths reach scope validation. The initial Keychain read is still required for startup.

## Inbox access in Sharing

Sharing shows inbox grants for trusted peers and supports grant and revoke through the authenticated daemon. Receiving a file continues to require confirmation for each offer. Sharing can open the current profile inbox through the OS file manager once the directory exists. Native smoke checked the absent directory result and intercepted the OS call to verify its fixed destination. Native smoke verified denial for an untrusted fingerprint, then seeded a trusted peer in a dedicated test profile and exercised grant and revoke through the UI. Inbox grants can now be issued for one hour, 24 hours, or until revoked. Native smoke with the temporary-key daemon verified the one-hour expiry is displayed and persisted through authenticated IPC before revocation. Transfer between physical devices remains unverified.

## Services native smoke

Services now has repeatable native smoke coverage for registering and removing a loopback service and granting and revoking its access. The test compares Electron actions against CLI state in both daemon lifecycle modes and checks IPC rejects a non-loopback registration target. It simulates the removal confirmation and does not open a tunnel. The Services grant form also supports one hour, 24 hours, or until revoked. Native smoke with the temporary-key daemon verified the persisted 24-hour expiry, rejection of an invalid duration, and early revocation. A macOS regression test relays real loopback data over authenticated QUIC, advances the authorization clock to a stored grant's exact expiry, and verifies the stream closes before its timeout. Expiry and revocation tests passed five race-enabled runs. Cross-device Bridge verification remains pending.

## Permission activity in Settings

Settings reads the daemon's permission audit on demand and shows fingerprint, resource, operation, time and optional expiry. Native smoke with the isolated ephemeral-key daemon verified the actual Inbox and Bridge grant and revoke events in newest-first order.

## Security and architecture

See [architecture](docs/architecture/overview.md), [IPC](docs/protocols/ipc.md), [threat model](docs/security/threat-model.md), and [macOS foundation ADR](docs/decisions/ADR-001-macos-foundation.md). The socket authenticates the OS user. Same-account applications remain inside that trust boundary. The current slice browses Bonjour only on explicit request. The experimental TLS listener and Bonjour TCP publication are disabled by default and require explicit daemon flags.

The macOS arm64 notice audit compared every bundled license, notice, and linked Go module patent file against its installed source. The [architecture overview](docs/architecture/overview.md) now describes the implemented pairing, transport, and local boundaries. Release review and other platform designs remain open.

## Desktop layout and simplified onboarding

The desktop is grouped into `src/main`, `src/preload`, `src/shared` and `src/renderer`. Renderer responsibilities are split across app composition, layout, pages, features, services, styles and types. The [design mapping](DESIGN_SYSTEM.md) documents how the view follows the supplied reference. Terminal and remote command execution are deferred from the current scope.

Devices has a fixed Nearby Devices heading and Pair Device action. That action starts discovery, and choosing a nearby result fills the adapter and endpoint while leaving fingerprint comparison and dual consent in place. Sharing selects from trusted peers and reuses the successfully paired endpoint in the current app session. A peer without a session endpoint uses Connection address. Network can approve the explicitly selected adapter and start its LAN listener in one action. Port and incoming-pairing settings remain under Advanced options.

`make verify dmg-macos` passed. Native smoke with an ephemeral-key daemon verified fixed header and sidebar positions while scrolling and one-step LAN activation. An Electron fixture verified the discovery-to-pair-to-send UI path and endpoint reuse. The ad hoc image `dist/macos/0.1.0-arm64-9ugluA/Lanvory-0.1.0-arm64.dmg` passed SHA-256, strict code-signature verification, and mounted startup with the bundled daemon and CLI. Full pairing and file transfer between physical devices remain unverified.

## Appearance and desktop workflow verification

Settings now persists Reduce motion in the desktop profile. The OS preference also suppresses motion. The setting controls the Settings and Network disclosure transitions.

The desktop build and `make verify GO=/usr/local/go/bin/go` passed on macOS arm64. Native smoke passed with an ephemeral-key daemon in an isolated profile, including reduced motion after renderer reload, the Radix pairing checkbox with both values, and automatic adapter revocation after turning off LAN. The updated Sharing and Services layouts were exercised with Electron fixtures. Sharing cleared the pending file selection and accepted reselection. Services showed the pairing action when no devices were paired, submitted the manual connection fields, and fit a 610 px window. These checks used one host.

## Latest macOS arm64 package

The current desktop changes are packaged in `dist/macos/0.1.0-arm64-KPq7QQ/Lanvory-0.1.0-arm64.dmg`. The DMG build and verification, SHA-256 sidecar, read-only mount, and strict deep verification of the mounted app signature passed. The mounted Radix Checkbox 1.4.1 license matched the installed dependency byte for byte. A separate read-only mount passed a startup smoke in an isolated profile. The mounted app launched its bundled daemon as a child, the bundled CLI returned identity, and the renderer displayed the Services connection panel, Sharing inbox panel, and Settings Reduce motion control. Both mounts were detached. Developer ID signing, notarization, and two-host LAN validation remain open.

## CI packaging verification

The macOS GitHub Actions workflow now runs `make verify dmg-macos`. This adds a signed ad hoc bundle, disk image verification, and notice collection to the build gate. Workflow YAML parsing, read-only permission check, frozen pnpm install, Go formatting, and the equivalent make target passed locally on macOS arm64. The local CI-equivalent run produced `dist/macos/0.1.0-arm64-LFQYyE/Lanvory-0.1.0-arm64.dmg`. CI does not publish the image. The workflow remains unverified on a hosted runner.

## Services device labels

Services uses the peer name when available and includes a short Device ID in device selectors and access grants. The submitted fingerprint remains the full identity. Type checking, the renderer build, and native smoke with an isolated ephemeral-key daemon passed. The native smoke selected the shortened label and verified the timed grant for the full fingerprint through the CLI. This change follows the previously verified DMG.

## Native lifecycle verification with the standard daemon

`make smoke-native GO=/usr/local/go/bin/go` passed on macOS arm64 using the normal binaries and login Keychain, with separate temporary profiles for app-owned and externally started daemons. The app shut down its own daemon on exit and left the external daemon running. The desktop startup preference, current Network flow, local Sharing and Services permissions, and Settings audit activity passed in the same run. README now describes Electron launcher initialization and the current LAN controls. This run used one host.

## Version information in Settings

About Lanvory reports the desktop package version and the protocol version from the daemon identity. It shows an unavailable protocol version when the identity cannot be read. Type checking, the desktop build, and native smoke in both isolated daemon ownership modes passed. Native smoke checked the displayed values against the manifest and the bundled development CLI. Daemon build version and license information are still open in the About section.

## Open-source notices in About

About Lanvory can open the signed bundle’s Notices directory through trusted local IPC. Development builds explain that notices are available in packaged builds. `make verify dmg-macos` and both standard native smoke modes passed. The current image is `dist/macos/0.1.0-arm64-Z3PkWz/Lanvory-0.1.0-arm64.dmg`. Its SHA-256, mounted bundle signature, bundled daemon startup, CLI identity, and About notice-opening IPC passed. The first detach reported the volume busy just after opening Finder. A later mount-table check confirmed the volume was no longer mounted. Daemon build version and physical two-host validation remain open.

## Daemon build information

About now displays the active daemon build separately from the desktop and protocol versions. The project Makefile stamps the daemon from the desktop package manifest using Node and Go. Direct Go builds report `development`, and an older daemon without the field remains compatible. The build value is returned by local identity IPC. `make verify smoke-native GO=/usr/local/go/bin/go` passed on macOS arm64, with About values checked against the package manifest and CLI in both daemon ownership modes. The latest verified DMG predates this change.

## Sharing file selection verification

Native smoke now selects, clears, and reselects a temporary file through the Sharing view, real preload, and main-process IPC. The OS picker result is stubbed. The smoke checks that clearing disables Send file and preserves the source file. `node --check apps/desktop/tests/native-smoke.cjs` and `sh scripts/smoke-native.sh pnpm` passed in both daemon ownership modes. This check does not exercise a remote transfer.

## Sharing action feedback

Sharing announces outgoing file actions and incoming offer decisions in separate live status regions inside their respective cards. The desktop type check and build passed. An Electron fixture reproduced an outgoing picker error followed by an incoming approval and confirmed that both messages remained visible in the appropriate cards. Physical two-device file approvals and transfer progress remain open.

## Sharing refresh ordering

Sharing discards a transfer snapshot that started before a successful incoming offer decision, preventing it from restoring the dismissed offer. Normal polling continues and refreshes history. An Electron fixture reproduced the stale offer before the change, then verified that the same delayed snapshot no longer restored it and a later snapshot displayed completed history. Type checking and the desktop build passed. This fixture uses one host and simulated transfer snapshots.

## Active transfers and history

Sharing shows waiting and streaming transfers in an Active transfers card. Terminal states appear in Transfer history, and a completed transfer moves there on the next snapshot. Type checking and the desktop build passed. An Electron fixture verified progress byte values, a failed history entry, and a streaming transfer moving into history on completion. The fixture does not replace physical two-device Drop validation.

## Persisted Sharing history smoke

The external-daemon native smoke seeds a completed record into the isolated SQLite database with the daemon stopped. After restart, Sharing shows the historical filename, direction, state and byte count through the production CLI and IPC path. It also checks that the completed entry stays out of Active transfers. Both native smoke modes and the test syntax check passed. The completed record is seeded data on one host.

## Incoming file count in navigation

The Sharing sidebar entry displays the number of pending incoming offers while the window is visible. Other tabs reuse the workspace refresh, while Sharing reports its own snapshot count so the workspace does not duplicate that request. The accessible button name includes the pending count. Type checking and the desktop build passed. An Electron fixture confirmed the badge appeared on Devices before opening Sharing, cleared after approval, and stayed clear after navigating to Network. Background OS notifications for file offers were not exercised.

## macOS image for the next physical LAN run

`make verify dmg-macos GO=/usr/local/go/bin/go` produced `dist/macos/0.1.0-arm64-2AxUzV/Lanvory-0.1.0-arm64.dmg`. SHA-256, strict deep signature verification, and startup from a read-only mount passed. In a fresh profile, the mounted app started its bundled daemon, the bundled CLI reported daemon build `0.1.0`, and About showed the same value. The mounted renderer displayed Sharing’s incoming and history panels, the Services connection panel, and About’s notice control. The image was detached. This is a one-host build and startup check.

## SQLite file protection

On macOS the daemon prepares the SQLite file at startup with mode `0600` and tightens the mode of existing files before opening SQLite. The startup path requires a regular file owned by the current user and rejects symbolic links and hard links. Storage tests verify new file permissions, reopen of a legacy `0644` file with the profile preserved, and link rejection. The full `make verify smoke-native GO=/usr/local/go/bin/go` run passed on macOS arm64. The release test DMG predates this storage change.

## Migration regression and transfer history removal

The macOS storage race tests verify that an unsupported newer SQLite schema is refused without changing the existing profile, and that a failed migration rolls back earlier schema changes before a successful retry.

Sharing now removes finished history entries through the local daemon and SQLite after an inline confirmation. The operation leaves source and received files on disk. Go tests cover owner isolation, rejection of active transfers, repeated deletion, and reopening persisted history. A targeted Electron run with a test-key daemon verified the confirmation and SQLite deletion. The full native smoke did not finish in that run because the standard daemon did not become ready before the deadline. Physical LAN validation is still open.

## Current macOS test image with history removal

`make verify dmg-macos` built `dist/macos/0.1.0-arm64-fIRn01/Lanvory-0.1.0-arm64.dmg` on macOS arm64. Both standard native smoke modes passed, including desktop confirmation and SQLite deletion through the real CLI and daemon. The DMG checksum and read-only mounted signature passed. The first isolated mounted launch timed out waiting for App ready. A fresh mount and profile passed bundled daemon startup, the CLI command listing for history removal, and the Sharing, Services and About checks. The cause of the first timeout or its reproducibility has not been established. The two-device runbook now checks that deleting history survives restart and preserves the received file and checksum.

## Desktop startup status

The sidebar now shows Starting Lanvory while the owned daemon is starting and Taking longer to start after the eight-second threshold. An Electron check used production main, preload, and renderer code with a temporary child process that stayed alive without making a daemon socket. It verified both sidebar messages and their IPC states. Type checking, the renderer build, and main-process syntax verification passed. This change improves startup reporting and does not establish the cause of the earlier mounted startup timeout.

## Recovery after an app-owned daemon crash

After a daemon that answered local identity requests exits unexpectedly, Electron schedules a recovery attempt subject to its existing launch cooldown. The attempt probes the owner-only socket first and spawns the bundled daemon only if the probe fails. A failed startup stays available for manual retry. A new daemon retains the local identity and starts in local-only mode. Both native smoke modes passed on macOS, including a forced exit of the daemon owned by the test app, recovery under a new PID, unchanged identity, and shutdown on quit. The existing DMG predates this change.

## Retry from My device

When desktop identity is unavailable and startup is not already pending, My device displays a Retry button next to View status. A completed manual retry invalidates older renderer identity polls. Type checking and the desktop build passed. An Electron fixture began with an unavailable daemon response and verified that Retry restored the device name and View device ID action without opening the status dialog.

## Transfer history search

Sharing filters completed history entries by filename and shows each entry's terminal-state timestamp in the desktop locale. The search ignores case and surrounding whitespace and shows an explicit no-results state. The desktop type check and build passed. An Electron fixture confirmed timestamp markup, a single match, an empty result, and restoring both entries after clearing the search. Physical transfer validation remains open.

## Transfer counterpart names

Sharing displays the sender on incoming offers and the source or destination on active and historical transfers. It uses local paired-device names or the standard DEVICE prefix label. Type checking, the desktop build, and both native smoke modes passed. Native smoke checked the label on seeded history from the daemon. An Electron fixture checked a saved custom name on an incoming offer and an outgoing history entry.

## Sanitized network diagnostics

Network → Connection diagnostics can copy a local report containing platform, application and daemon versions, protocol version, listener state, and adapter counts. The main process constructs it from a fixed set of fields. It omits device and adapter names, fingerprints, addresses, file paths, and raw errors. Type checking, the desktop build, and both native smoke modes passed. The smoke intercepts clipboard writes and verifies the report contains real counts without identifiers. The current DMG predates this addition.

## Active transfer rate and remaining time

The daemon reports elapsed streaming time from its monotonic timer in active transfer snapshots. Time spent waiting for approval is excluded. Sharing uses the reported elapsed time and transferred bytes to show average throughput and approximate time remaining. The metrics disappear after completion and do not change the SQLite schema. `make verify`, the desktop build, and an Electron fixture passed. The fixture verified 40 bytes over two seconds produces 20 B/s and about three seconds remaining for a 100-byte file. Physical throughput and transfer validation remain open.

## Drop partial progress regression

A race-enabled Drop integration test uses a staged byte stream and the production inbox receiver. It verifies that a file waits for approval, reports a partial byte count and elapsed streaming time, remains unpublished until verification, and then appears with exact contents and completed history. The targeted test passed 20 consecutive race-enabled runs. The test exercises the receiver on one host using an in-memory pipe.

## Sharing file drop

The Sharing file selector accepts one disk-backed file at a time. Electron resolves the local path in preload, and the main process accepts only a regular file and returns its basename. The existing recipient, explicit Send file action, and removal flow apply to dropped files. Type checking, build, Go verification, and both native smoke modes passed after retrying an initial daemon readiness timeout. Native smoke dispatches a drop from a disk-backed File and checks that a script-created File is rejected. Native Finder drag and physical LAN transfer remain open.

## Current macOS test image with file drop and diagnostics

`make verify dmg-macos` produced `dist/macos/0.1.0-arm64-6JdLbU/Lanvory-0.1.0-arm64.dmg`. The SHA-256 sidecar, read-only mount, strict deep app signature and mounted startup passed. The bundled daemon and CLI reported build `0.1.0`, matching About. The mounted UI displayed Sharing history, Services, and the Network diagnostic-report control. The updated two-host runbook covers Finder drag, explicit Send, and measured transfer progress. These build and launch checks used one macOS arm64 host.

## macOS SBOM

The macOS packager emits a CycloneDX 1.6 JSON sidecar for both bundle and DMG builds, using the npm dependencies resolved for notices, modules reported by the native binaries, and the Electron and Go runtime versions. `make verify dmg-macos` passed. The generated `dist/macos/0.1.0-arm64-bLP2iO/Lanvory-0.1.0-arm64.cdx.json` passed validation against the official CycloneDX JSON Schema. It contained 50 unique components, including the expected Electron, Radix Checkbox, and quic-go versions. The inventory covers the npm closure and linked Go modules. It does not enumerate Electron internals or macOS libraries. No release artifact was published.

## SBOM package identifiers and signed binary checksums

The package SBOM now includes npm and Go Package URLs and SHA-256 hashes for the signed bundled CLI and daemon. The macOS DMG build produced `dist/macos/0.1.0-arm64-ZGV9Gw/Lanvory-0.1.0-arm64.cdx.json`. A local verification validated the CycloneDX schema, checked unique Package URLs including a scoped npm dependency, compared all listed Go modules with the embedded binaries, and verified both hashes against the signed bundle.

## Repeatable packaged startup smoke

`sh scripts/smoke-macos-dmg.sh PATH_TO_LANVORY_DMG` verifies the sidecar, read-only mount, signed application, bundled notices, app-owned daemon, and bundled CLI with an isolated profile. The helper is documented in the macOS deployment guide and its shell syntax is checked by `make verify`. It rejected a wrong checksum and passed against the `ZGV9Gw` DMG. The test mount was detached. It exercises local startup on one host.

## Mounted SBOM verification

The DMG smoke checks any adjacent CycloneDX inventory against both signed native binaries on the read-only mount before launching the application. The unchanged ZGV9Gw image passed with its original inventory. The same image paired with a temporary inventory containing an incorrect daemon hash was rejected before startup. Both test mounts detached successfully.

## Non-interactive macOS verification in CI

The macOS workflow now runs the DMG smoke in verify-only mode. It requires the generated SBOM and inspects the mounted application without launching it. Workflow YAML and shell syntax passed. A missing SBOM was rejected, and the exact new workflow step passed against the ZGV9Gw DMG in an isolated directory. The mount table confirmed cleanup. Hosted GitHub Actions execution remains unverified.

## Remembered Network connection settings

Network remembers the last port and incoming pairing choice after successful LAN activation. Saved data is validated when loading. The settings are stored in the desktop profile and do not restart the listener or approve an adapter automatically. Type checking, the desktop build, and both native smoke modes passed. Native smoke verified a port of zero and disabled incoming pairing were restored after leaving and reopening Network.

## Network approval after failed activation

If Turn on LAN adds an adapter approval but the listener fails to start, Network removes the added approval after confirming the listener is off. It retains an earlier approval and leaves permissions in place when listener status is unavailable. Type checking and the desktop build passed. An Electron fixture exercised all three paths and verified the expected approval IPC calls. The fixture used simulated listener responses.

## Native listener bind failure regression

Native smoke now holds a socket open on an eligible adapter and requests that exact address and port through Network. The real daemon refuses the conflicting bind, the listener stays local-only, and the interface inventory confirms the new approval was removed. The socket is closed before continuing to the normal successful activation checks. Both native smoke modes and the syntax check passed on one macOS arm64 host.

## Current macOS test image with Network recovery

`make verify dmg-macos` produced `dist/macos/0.1.0-arm64-LdggrH/Lanvory-0.1.0-arm64.dmg` with the saved connection settings and failed-activation approval rollback. The SBOM passed CycloneDX schema validation and matched the four linked Go modules and two signed native binaries. The repository DMG smoke passed checksum, read-only mounted signature, notices, SBOM hash, bundled daemon, and local CLI checks. The mount detached. The Network rollback was verified separately by standard native smoke on the same macOS host. Physical two-host LAN validation remains open.

## Discovery response ownership

The Devices renderer invalidates scan and resolve replies when its discovery view unmounts or the local identity changes. The dashboard count resets on a new scan or when leaving the view. Type checking and the desktop build passed. An Electron fixture confirmed that a resolution arriving after navigation did not select a peer, and a subsequent selection still opened the pairing flow. Two-host discovery remains unverified.

## Manual pairing from discovery

Devices now offers Pair by address next to an empty or failed discovery result or a failed address resolution. It expands and focuses the manual pairing form. The no-approved-adapter state continues to offer Network setup. Type checking, the desktop build, and Electron fixtures for an empty approved scan and the no-adapter setup path passed. Manual pairing over a physical LAN still requires the two-host run.

## Approved adapter selection for manual pairing

Pair by address now shares the Network interface reader and offers only eligible approved adapters. It preselects a single option and links to Network when none is approved. The manual adapter field remains available when the inventory request fails. Type checking, the desktop build, and Electron fixtures passed for the single-adapter form value and the no-approval route to Network. Two-device pairing remains unverified.

## Native manual pairing adapter check

`make verify smoke-native` passed on macOS arm64. In both daemon ownership modes, native smoke turns on LAN through Network and opens Pair by address. The form preselects the real approved adapter obtained through authenticated IPC and returns the expected adapter value in FormData. The smoke does not submit a remote pairing request for this case.

## Copy the active LAN address

Network exposes an icon to copy the local listener address and port while LAN is running. The main process checks the displayed endpoint against current daemon status before writing to the clipboard. Type checking, build, and both native smoke modes passed. They captured the exact active endpoint and verified that an unrelated address was refused. This check used one host.

## Copy and paste manual pairing details

My device can copy the current local LAN endpoint and Device ID together when the daemon allows incoming pairing. Its IPC rechecks the current identity and listener. Pasting the text into the Device ID field in Pair by address fills both values, leaving the user to review and send the request. Type checking, build, and both native smoke modes passed, including the live daemon clipboard payload and manual form values. The two-host runbook describes the new path. Remote pairing has not been exercised by this check.

## Pairing export availability

My device now shows Copy pairing details only while the local listener accepts incoming pairing. Copy device ID stays available independently. The desktop build and both native smoke modes passed. Native smoke verified the daemon-side refusal when incoming pairing was disabled, and an Electron fixture verified the button followed a change in the reported listener state.

## macOS x64 core under Rosetta

The Go core was built on Apple Silicon with `GOARCH=amd64 CGO_ENABLED=1`. Go vet and all race-enabled core tests passed under Rosetta, and `lipo -archs` reported `x86_64` for both binaries. The x64 CLI and daemon also passed the identity smoke with isolated state and the login Keychain, including identity persistence, fingerprint verification, default-deny, and duplicate-daemon rejection. Native Intel desktop and DMG verification remain open.

## macOS x64 DMG under Rosetta

The macOS packager supports an explicit target architecture with binaries from a separate directory, and checks the architecture of Electron, CLI, and daemon. A mismatched arm64 binary was refused for an x64 target. The signed x64 bundle and DMG are under `dist/macos/0.1.0-x64-hJ5JCw/`. All three executables are `x86_64`. CycloneDX validation, binary hashes, mounted signature, and verify-only smoke passed. The signed CLI and daemon passed the independent identity smoke. Two mounted app launches timed out before readiness with no confirmed cause. A fresh mounted launch then passed the bundled daemon and CLI smoke under Rosetta. Native Intel hardware, Developer ID signing, and physical LAN validation remain open.

## macOS hosted architecture matrix

The verification workflow now has separate arm64 and Intel jobs using the published GitHub macOS 15 labels. Each asserts its runner architecture and inspects only its own DMG and SBOM output. YAML checking passed. The architecture command passed locally on arm64 and under Rosetta, and the exact mounted verification commands passed for both local images with both architectures present in the fixture directory. No hosted job or physical Intel test ran.

## Linux core CI

The verification workflow adds an Ubuntu 24.04 job for Go vet and race tests. Workflow YAML and Linux amd64 cross-build of the two command binaries passed. Go vet and the complete platform-selected race suite ran successfully in a local Linux arm64 container using Go 1.26.11, with the source mounted read-only and container networking disabled. This exercises the portable core and Linux local IPC. Linux desktop, Secret Service, persistent storage, and discovery adapters are still open. Hosted CI remains unverified.

## SQLite storage on Linux

Linux with cgo now uses the shared SQLite implementation and schema. An offline Linux arm64 container with the SQLite development package passed Go vet, the race suite including storage tests, and builds of both commands. The macOS `make verify` run and the Linux amd64 no-cgo cross-build also passed. CI now explicitly installs `libsqlite3-dev` before its Linux tests. A local Docker test image was retained. Linux without cgo still uses the unsupported storage path, and the production Linux daemon still needs Secret Service, scoped binding, and discovery adapters.

## Linux storage-backed IPC coverage

The existing trust and permission route tests now run on Linux as well as macOS with cgo. They exercise SQLite-backed trust and grant changes, denial before verification, and denial after revocation. The targeted race checks passed on macOS and in the offline Linux arm64 container. Linux Go vet and the full platform-selected race suite also passed. These tests inject peer verification behavior and do not require a running Secret Service or remote peer.

## Linux Secret Service identity

Linux builds with cgo now store the Ed25519 seed in the default Secret Service collection through libsecret. Initialization uses a private per-user cache lock across daemon state directories. An unreadable, duplicate, or malformed credential stops startup, and there is no plaintext fallback. Linux CI installs the build headers. In an offline Linux arm64 container, Go vet, all race tests, both builds, and a GNOME Keyring smoke passed. The production CLI reported the same identity across separate D-Bus sessions and state directories, and the daemon rejected startup without a reachable service. Native Linux desktop, scoped LAN transport, discovery, and packaging remain open.

## Linux interface-bound sockets

The TCP listener, outbound TCP dialer, and QUIC sockets now apply the approved Linux adapter index with `SO_BINDTOIFINDEX`. Socket creation fails if the index is zero or the kernel rejects the bind. An offline Linux arm64 container ran as UID 65534 with all capabilities dropped. Its loopback tests checked the kernel-reported index on TCP listener and client sockets and a UDP socket, and verified rejection of a zero index. Go vet, the full race suite, and both Linux command builds passed. The Linux amd64 no-cgo cross-build also passed. Linux discovery and physical-adapter validation remain open.

## Linux listener startup through local IPC

The listener start route enables TCP, QUIC, and the requested pairing policy on approved adapters. It requests discovery publication only in builds that provide it. Linux supports manual connections by address, and explicitly requesting publication with `lanvoryd --peer-advertise` fails before opening sockets in an unsupported build. Linux Go vet, race tests, and both command builds passed. macOS `make verify` passed. An unprivileged CLI and daemon smoke on an isolated Docker network verified rejection before approval, a stable listening state after approval, QUIC startup, incoming pairing enabled, and an explicit stop. It used one virtual adapter and did not connect to a remote peer.

## Linux pairing and Drop across isolated containers

Two unprivileged Linux arm64 containers ran separate production daemons with independent GNOME Keyring and SQLite state on an internal Docker network. The CLI smoke verified rejection of mutual verification before pairing, matching confirmation codes, empty trust lists after only one approval, and mutual TCP and QUIC verification after both approvals. Drop was refused before an inbox grant, the receiving file did not exist while approval was pending, and the completed file matched the source SHA-256. After restarting the recipient container, its identity, paired peer, and transfer history were still present. Revoking trust on the sender prevented the recipient from mutually verifying that sender. Physical LAN, discovery, and renderer interactions remain separate verification work.

## Linux Bridge across isolated containers

Two unprivileged Linux arm64 daemons ran on an internal Docker network. The client tunnel bound to loopback and denied requests before the service owner granted access. After the grant, the same tunnel relayed the expected bytes from the registered loopback service. Revoking access closed the live connection and denied a new request. Stopping the tunnel closed its local port. The same checks passed with the service daemon restarted in TCP-only mode, after independently verifying pinned TCP succeeded and QUIC verification failed. This exercised the production CLI and daemon on virtual adapters.

## Declined pairing and adapter revocation across isolated containers

Declining on the recipient cleared both pending request lists and wrote no trust. An immediate retry hit the existing ten-second per-source cooldown. Retrying after the cooldown succeeded. During an active Bridge stream, revoking the recipient's adapter closed the loopback service connection within the five-second observation window and prevented new TCP and QUIC verification. Local IPC and paired-device records remained available. The remote client did not observe EOF within eight seconds on the first run, but did observe EOF within the extended 75-second deadline. Reapproving the adapter and restarting the listener restored TCP and QUIC verification and Bridge relay with the retained pairing. The physical runbook now distinguishes the time the service closes from when the remote client observes closure.

## Manual pairing when automatic discovery is unavailable

Builds without a discovery backend return an explicit unavailable result with the eligible approved interfaces. Devices uses that result to show network setup when approval is missing or Pair by address when an adapter is ready. Supported discovery still distinguishes an empty scan from a backend error. Linux Go vet and the race suite passed, including the result test. macOS `make verify` and the desktop build passed. The separate Linux CLI smoke command was rejected before launch, so this result has not been verified through the production CLI or in Electron.

## Current macOS native smoke

The current arm64 daemon, CLI and renderer built successfully. The first managed Electron smoke timed out before daemon readiness. A standalone daemon with isolated state subsequently answered the identity CLI, and a fresh `sh scripts/smoke-native.sh pnpm` run passed both managed and external daemon modes. It verified rollback after bind failure, adapter revocation when turning LAN off, and persisted history removal through the Sharing trash action. The initial timeout cause remains unconfirmed. This run used one macOS host.

## Current macOS arm64 DMG

`make dmg-macos` produced `dist/macos/0.1.0-arm64-TVfoCk/Lanvory-0.1.0-arm64.dmg`. The full repository DMG smoke passed on its first read-only mount with a fresh profile. It checked the SHA-256 sidecar, strict deep app signature, notices, mounted binary hashes, bundled daemon startup, and the bundled identity CLI. The mount detached. The local CycloneDX validator also checked the inventory against the 1.6 schema, the four embedded Go modules, and both bundled binary hashes. The image is ad hoc signed. Physical LAN validation and Developer ID notarization remain open.

## Current macOS x64 DMG under Rosetta

The updated x64 image is `dist/macos/0.1.0-x64-J9wX37/Lanvory-0.1.0-x64.dmg` with SHA-256 `07d58014c41bac0cd1392faf230affefd84e2184aa45e363f13ffd28a8eabdfc`. Electron, CLI and daemon are all `x86_64`. The DMG checksum, mounted app signature, notices, SBOM and binary hashes passed. The first mounted launch did not retain a daemon child before the deadline. A second launch reached a daemon and Unix socket but not identity readiness. A third fresh launch passed the full bundled daemon and CLI smoke under Rosetta. The smoke script now prints the isolated app log and, when a daemon socket exists, the bundled CLI error and a short daemon stack sample on timeout. Full Go vet and race tests, TypeScript and all script syntax checks passed after the diagnostic change. The intermittent startup cause remains unconfirmed. Native Intel hardware was not used.

## macOS release verification

The mounted startup smoke now checks readiness after its final sleep. Previously, a socket first created during that sleep could appear in the timeout diagnostics without the CLI ever being invoked. Shell syntax passed. A fresh read-only mounted run of the x64 image under Rosetta exited successfully with the updated script, verifying the DMG checksum, mounted signature, both SBOM binary hashes, bundled daemon startup, and identity through the bundled CLI. This run did not reproduce the timeout or establish why the daemon started late previously.

The packaged startup smoke retains stderr from the last identity probe without launching an extra probe after the readiness loop. `make verify GO=/usr/local/go/bin/go` passed. A fresh mounted run of the x64 image verified the bundled binary hashes, then failed startup readiness. At diagnosis time a daemon and socket existed, with no captured probe stderr. The Rosetta process sample timestamp was approximately 0.49 seconds after the sampled daemon's launch. This indicates a late daemon start or restart in that run, and the available sample does not establish why it happened.

The DMG smoke now accepts `--verify-release` to check the disk image signature and stapled notarization ticket before the existing read-only bundle and inventory checks. The deployment runbook regenerates the checksum sidecar after stapling. Shell syntax and the existing arm64 verification mode passed. Release mode rejected the unsigned test DMG before mounting. The current Keychain reported zero valid codesigning identities, so the positive Developer ID and notarization check remains unverified.

## Current same-host macOS Bonjour preflight

The two opt-in native listener tests passed uncached with the race detector on en0. Both checked kernel adapter binding, registration, browse and resolution, same-host address filtering, and withdrawal after revocation. TCP disappeared on the second post-revocation scan. QUIC emitted a receive-buffer tuning warning because its packet connection is wrapped, and the UDP test passed. The physical LAN runbook now includes the optional same-host command. No remote host was used.

## Shared Settings checkboxes

Settings uses the existing shadcn-style Checkbox for Reduce motion, Launch at login, Pairing notifications, and Start minimized. Both macOS native smoke modes passed. They exercised motion and notification persistence and toggled Start minimized through its visible label. The development build still hides Launch at login, so this run did not register a login item on macOS. Desktop type checking and build passed. The current DMGs predate this renderer change.

## macOS DMGs with shared Settings checkboxes

The current local images are `dist/macos/0.1.0-arm64-mZZdZv/Lanvory-0.1.0-arm64.dmg` and `dist/macos/0.1.0-x64-zMHnTp/Lanvory-0.1.0-x64.dmg`. The bundled renderer index, JS, and CSS in both archives match the build with shared Settings checkboxes. CycloneDX schema validation, binary hashes, and architecture checks passed for both. The arm64 image passed the full mounted smoke. The first x64 mounted run timed out with no running daemon child. The signed x64 daemon then answered the bundled CLI in an isolated standalone run, and a fresh mounted x64 run passed the full smoke under Rosetta. The x64 startup timeout cause remains unconfirmed. Neither image was used to register a macOS login item.

## Login item status on window focus

Settings refreshes Launch at login when the window regains focus and ignores obsolete reads during a preference write. Type checking, build, and both macOS native smoke modes passed. The smoke simulated a macOS approval-state change through Electron IPC and checked the checkbox and approval hint after focus. Installed login item registration and a real login session remain unverified. The current DMGs predate this renderer change.

## Sharing recipient availability

Sharing requires the selected recipient to appear in the loaded paired-device list before enabling file selection or submission. A previously selected file can still be cleared when its recipient is unavailable. Type checking, the desktop build, and both macOS native smoke modes passed. The smoke removed and restored its fixture peer in an isolated database and verified the disabled controls and file deselection while the peer was absent. The current DMGs predate this renderer change.

## Services preselects a sole paired device

Connect to a service preselects the only paired device from the live service snapshot. An existing selection is preserved while it remains available, and a disappeared selection is not replaced automatically. Type checking, the desktop build, and both macOS native smoke modes passed. The smoke checked the displayed device name and the fingerprint submitted by the form. It did not open a tunnel to a physical peer. The current DMGs predate this renderer change.

## Outgoing file send error propagation

The local daemon HTTP handler at `/v1/files/send` now preserves the exact underlying error message on status 502 (Bad Gateway) when `peer.SendFile()` fails, instead of discarding the message. The Unix IPC client in `core/internal/local/socket.go` parses the 502 response body, preserves `drop.ErrNotAccepted` when matched, and returns the descriptive error instead of falling through to a generic "daemon returned 502 Bad Gateway" string. `make build-core` and `make verify` passed on macOS arm64.

## Current macOS arm64 DMG with file send error propagation

`make dmg-macos` produced `dist/macos/0.1.0-arm64-dYoG2V/Lanvory-0.1.0-arm64.dmg`. The SHA-256 sidecar, strict deep app signature, and read-only mounted startup passed. The CycloneDX validator verified both SBOM hashes against the bundled `lanvory` and `lanvoryd` binaries. An isolated mounted launch started its bundled daemon and returned identity via the bundled CLI. The image is ad hoc signed. Physical LAN validation and Developer ID notarization remain open.

## Cross-platform architecture and platform boundaries

`docs/architecture/cross-platform.md` documents the security and platform boundaries for Linux and Windows alongside the implemented macOS architecture. It details credential storage (Freedesktop Secret Service for Linux, Windows Credential Manager and DPAPI for Windows), local IPC (Unix socket with `SO_PEERCRED` for Linux, Named Pipes with single-user DACL for Windows), kernel interface binding (`SO_BINDTODEVICE` for Linux, `IP_UNICAST_IF` for Windows), and packaging pipelines. Task `ARCH-01` is marked complete.

## Known limitations report

`docs/development/known-limitations.md` documents technical boundaries, network scope rules, AP client isolation constraints, session-scoped listener mechanics, single-file MVP transfer limits, and platform/signing constraints in accordance with PROJECT_SPEC.md Deliverable 35 and Acceptance Criterion 26.

## Editable address and adapter defaults

Pairing, manual trust verification, Sharing, and Services use shared connection fields. Known peer addresses are editable and adapter candidates come from the current machine's approved interfaces and the daemon's scope check. Network defaults to a sole approved bind or a sole available bind, and Services displays its editable loopback bind default. TypeScript and native smoke script syntax passed. The app was not built and Electron smoke was not run for this change.

## Sharing and Services local adapter regression

Both native smoke modes passed a direct Pair by address case with two simulated approved scope matches. The submit button remained disabled until an adapter was selected. With that choice, the verified existing peer route was updated without starting a new pairing.

The discovery-to-pairing UI handoff carries the service name and resolved endpoints. The scan interface remains part of discovery resolution, and the pairing form independently evaluates the current local adapters. Repository verification and the desktop build passed after removing the obsolete adapter field from the handoff.

Pair Device now uses the same explicit selection rule as Sharing and Services. A discovery result still prefills the endpoint, while the shared form selects an adapter only for a sole approved scope match or an explicit choice. Desktop type checking, build and both native smoke modes passed. Pairing smoke exercised a sole match, while Sharing and Services exercised multiple matches in the shared form. Packaged DMGs predate the pairing change.

The two-device runbook includes revoking the sender's selected local adapter from the CLI while each desktop form is open. It records the expected approval feedback, retained file selection, and absence of a remote offer or new tunnel. This procedure awaits a physical run.

Sharing native smoke simulates adapter access being revoked after file selection. It verifies the approval error, retention of the selected file, and zero send-file IPC calls. Both managed and external daemon smoke modes passed with the fixture.

The native smoke checks a scope denial after selecting an adapter in Services. The renderer displays the approval error and the test confirms that no tunnel-open IPC is issued. Earlier runs timed out at the Network stop-listener control or at the Services sole-adapter check. The sole-adapter assertion now reports form and fixture match flags on timeout. Both daemon modes passed a fresh run with that diagnostic. The intermittent timeout cause remains unconfirmed.

Sharing also requires an explicit choice among multiple matches. Connection address opens when the route is missing or the form is not ready, making the adapter selector and scope feedback visible. Native smoke now verifies this directly in Sharing with simulated scope responses, including the selected adapter in form data. An initial run timed out in the preceding Services check. Both modes passed on retry. Physical LAN verification remains open.

Services requires an explicit adapter choice when multiple approved local adapters match the peer address, even if one matches the adapter saved with the peer route. It still prefills the saved address and automatically selects a sole match. Type checking, renderer build, and both native smoke modes passed. The overlapping-adapter case used simulated scope responses and verified the submitted selection.

Sharing and Services now have native smoke coverage for a saved peer route whose previous adapter name is not present on the current machine. The fixture provides two approved local adapters, allows only one of them to reach the saved peer IPv4 address through the daemon scope check, and verifies that both connection forms automatically submit that sole matching local adapter instead of the stale saved name. A second Services case allows both current adapters, verifies that no adapter is guessed, then selects and submits the user's choice. Type checking, the desktop build, and both macOS native smoke modes passed. The test uses simulated interface inventory and scope responses and does not transfer a file or open a tunnel to a physical peer.

## Current macOS arm64 DMG with explicit adapter selection

The matching current Intel image is `dist/macos/0.1.0-x64-0gMXW8/Lanvory-0.1.0-x64.dmg`. Packaging, checksum, mounted bundle signature and both SBOM binary hashes passed. Two isolated Rosetta startup runs timed out with no daemon child at the deadline. A third isolated run passed bundled daemon startup and CLI identity. The smoke script now samples the app process if a future timeout occurs without a daemon child. Shell syntax passed. The underlying intermittent startup cause remains unconfirmed.

The latest Apple Silicon image is `dist/macos/0.1.0-arm64-cA9Szj/Lanvory-0.1.0-arm64.dmg`. It also includes the Pair Device adapter selection changes. The DMG build and read-only mounted smoke passed, including checksum, signature, both SBOM binary hashes, daemon startup and CLI identity.

Both current image checksum sidecars were rechecked. The physical LAN runbook now covers the pairing adapter selection rule.

The previous Intel image is `dist/macos/0.1.0-x64-25bidy/Lanvory-0.1.0-x64.dmg`. Its checksum, mounted signature and both SBOM binary hashes passed. The first Rosetta startup smoke timed out with the socket appearing after the last probe. A fresh isolated run reached bundled daemon and CLI readiness. Native Intel hardware and a physical LAN remain unverified.

`dist/macos/0.1.0-arm64-ZtNiWP/Lanvory-0.1.0-arm64.dmg` includes the Sharing and Services changes that require an explicit choice among multiple matching adapters. `make dmg-macos GO=/usr/local/go/bin/go` and a read-only mounted startup smoke passed. The smoke verified the checksum, strict bundle signature, SBOM binary hashes, bundled daemon and identity through the bundled CLI. The earlier x64 image predates these changes.

## Previous macOS arm64 DMG with local adapter selection

The current local image is `dist/macos/0.1.0-arm64-lqSix1/Lanvory-0.1.0-arm64.dmg` with SHA-256 `7845e6a98fe3f26999207f49af67e43b59e5029bcca99063513a4fa7153f1b53`. The repository smoke verified its checksum, strict deep mounted signature, notices, CycloneDX inventory and both bundled binary hashes. A read-only mounted launch started the bundled daemon and returned identity through the bundled CLI. The full Go vet and race suite, TypeScript check and script syntax checks also passed. The image is ad hoc signed. Developer ID signing, notarization and physical two-host validation remain open.

## Refresh a paired device from discovery

Selecting an unverified discovery row resolves its address and tries a scoped TLS match against locally trusted keys. A match updates the editable route used by Sharing and Services and marks that row Paired without a new pairing request. Routes are saved per local identity in the desktop profile. The scan itself remains passive and a failed match leaves the saved route intact. TypeScript, Electron script syntax, and targeted Go trust and scope tests passed. No desktop build or physical two-device test ran.

## Keyboard shortcuts and Settings storage information

Lanvory now supports global keyboard shortcuts per PROJECT_SPEC.md §49: `Cmd+1` / `Ctrl+1` through `Cmd+5` / `Ctrl+5` to switch between Devices, Sharing, Services, Network, and Settings views, and `Escape` to cancel an active pairing target or dismiss dialogues. Settings features a dedicated "Keyboard shortcuts" reference card and a "Storage & inbox" card displaying the local inbox path (`~/.lanvory/inbox`) and integrity policy, alongside a one-click "Open inbox folder" action backed by `window.lanvory.openInbox()`.

Type checking, `make verify`, and both macOS native smoke modes (app-owned and externally started daemons) passed on macOS arm64. The automated native smoke verified that `Cmd+1` switched navigation to Devices and `Cmd+5` returned to Settings, and confirmed the presence of the new cards without perturbing the version information tests.

## Permission defaults preference

Settings now features a "Permission defaults" card per PROJECT_SPEC.md §46, allowing the user to select the default access duration (`Until revoked`, `24 hours`, or `1 hour`) for resource access grants. The preference is persisted in the local desktop profile (`lanvory.default-grant-duration`) and automatically applies as the preselected duration when granting inbox file request access in Sharing and service tunnel access in Services.

Both macOS native smoke modes exercised updating and persisting the default duration and confirmed compatibility with existing explicit duration options. Type checking, `make verify`, and native smoke passed on macOS arm64.

## Transfer history direction and status filters

Transfer history in Sharing now supports filtering past transfers by direction (`All directions`, `Received`, `Sent`) and by terminal status (`All statuses`, `Completed`, `Failed`) per PROJECT_SPEC.md §40 alongside the existing filename search. The filter controls are responsive and styled with Lanvory design system tokens.

Native smoke exercised the direction filter on seeded persisted history across a daemon restart, confirming that selecting `Sent` hid the incoming record and selecting `Received` restored it before testing history removal. Type checking, `make verify`, and both native smoke modes passed on macOS arm64.

## Permission activity audit display

Permission activity in Settings now resolves counterpart fingerprints to paired device names and renders shortened device ID badges alongside exact ISO timestamps and grant expiry details. The event action and resource title structure strictly maintains automated smoke compatibility.

Both macOS native smoke modes verified disclosure, refresh, and newest-first daemon event ordering. Type checking, `make verify`, and native smoke passed on macOS arm64.

## Shared services access and management interface redesign

The local service sharing and permission management interface under Services was redesigned to eliminate visual clutter, nested border exhaustion, and unclear access states:
- Each shared service card now features an icon badge, distinct local target indicator with active status pulse, and an immediate privacy/sharing summary (`Private · No devices have access` vs `Shared with N paired device(s)`).
- When no devices have access, an informative notice clarifies that the app is private and available only locally.
- Active device grants display friendly paired device names, device icons, expiry timestamps, and clean one-click revoke action buttons.
- The "Grant access to a paired device" form was restructured into a responsive two-column grid (`Paired device` + `Access duration`), drastically reducing vertical space and giving a clean, polished appearance consistent with the Lanvory design system.
- Full compatibility with existing DOM query selectors in automated native smoke tests was maintained.

`pnpm typecheck`, `pnpm build`, `make verify`, and `sh scripts/smoke-native.sh pnpm` all passed on macOS arm64.

## Core CLI diagnostics and device management commands

Implements core commands per PROJECT_SPEC.md §29 in `core/cmd/lanvory/main.go`:
- `lanvory version` and `lanvory --version`: prints binary version without connecting to the daemon.
- `lanvory devices` and `lanvory devices --json`: retrieves trusted paired devices via local IPC.
- `lanvory status` and `lanvory status --json`: checks daemon IPC connectivity and prints a structured summary of local identity, active listener endpoint, pairing status, trusted peers count, shared services, and active tunnels. Exits with code 1 with a descriptive error if the daemon is stopped.
- `lanvory doctor` and `lanvory doctor --json`: performs local environment diagnostics covering owner-only directory permissions (`0700`), daemon socket reachability, device profile, approved network adapters, and listener status.
- Added comprehensive unit tests in `core/cmd/lanvory/main_test.go` covering CLI output formats, stopped daemon error handling, and mock daemon integration.

`make build-core`, `cd core && go test -v -race ./cmd/lanvory/...`, `make verify`, and `sh scripts/smoke-native.sh pnpm` all passed on macOS arm64.

## Single-host performance and memory benchmark (PERF-01)

Added automated benchmark harness in `scripts/measure-perf.sh` implementing the single-host acceptance checks defined in PROJECT_SPEC.md §53:
- **Idle Memory Target**:
  - Live daemon RSS sampled at **21.8 MiB** (22,336 KiB), well below the **<= 64 MiB** ceiling.
  - Summed Electron desktop process tree RSS sampled at **200–348 MiB** across main, renderer, GPU, and utility helpers, satisfying the **<= 400 MiB** ceiling.
- **Daemon Recovery Target**:
  - Tested unexpected daemon SIGKILL termination and supervisor recovery across isolated profiles.
  - Recovery time recorded at **< 1.0 s** (0s integer elapsed), retaining the exact Keychain identity fingerprint (`969178db...847bf3`) and starting in local-only mode, well within the **<= 10 s** threshold.
- **First-run Configuration Count Target**:
  - Zero cloud login, zero WAN configuration steps, exactly 1 in-app toggle ("Turn on LAN") to enable local discovery.

`sh scripts/measure-perf.sh` passed on macOS arm64 Darwin. `make verify` checks syntax across all script assets.

## Settings privacy, diagnostics and device fingerprint (PROJECT_SPEC.md §46)

Settings was enriched to complete all remaining MVP configuration and privacy requirements:
- "My device" card now exposes the device's cryptographic identity fingerprint with shortened badge (`slice(0, 8)...slice(-6)`) and a dedicated one-click clipboard copy action backed by authenticated `window.lanvory.copyFingerprint()`.
- Added "Privacy & diagnostics" card displaying zero-telemetry policy, local SQLite storage location, and a "Copy diagnostic report" action leveraging `window.lanvory.copyNetworkReport()`.
- Responsive styling in `apps/desktop/src/renderer/styles/app.css` preserves exact DOM locators (`.settings-versions dd`) required by automated smoke tests.

`pnpm typecheck`, `pnpm build`, `make verify`, and `sh scripts/smoke-native.sh pnpm` all passed on macOS arm64.

## Menu Bar status and lifecycle integration (MAC-02, PROJECT_SPEC.md §48)

Corrected macOS Menu Bar status mapping in `apps/desktop/src/main/native-lifecycle.cjs`:
- Added `listening: 'LAN active'` to `statusLabels`, preventing `undefined` tooltip labels when the peer listener is active on an approved adapter.
- Added a safe fallback `statusLabels[status] ?? 'Lanvory ready'` for any unmapped daemon state.
- Retained clean lifecycle termination and native activation behaviors.

`make verify` and both app-owned and standalone daemon smoke passes in `sh scripts/smoke-native.sh pnpm` passed with code 0.

## Services device roles and runbook alignment

Services identifies the sharing device on the peer selector, service name and Lanvory address, and identifies the connecting device on the adapter and optional tunnel address. Active connections show which address to open locally. The native smoke passed in app-owned and external daemon modes, including field ownership and submitted endpoint, adapter and default bind. The two-device runbook (`docs/development/lan-validation.md`) was updated to strictly match the redesigned Services UI labels ("Share a local app", "Local app address", "Grant access to a paired device", "Connect to a service"). Physical two-device acceptance remains open.

## Settings and local configuration completion (CORE-02)

Task CORE-02 is now marked DONE. All MVP settings across General, Appearance, Network, Security, Storage, Privacy & Diagnostics, and About are fully implemented in the desktop client and validated through automated unit and native smoke testing:
- Appearance: Theme (Dark/Light/System), Text size (Default/Large), Interface density (Comfortable/Compact), Reduced motion.
- Startup & Notifications: Launch at login (with approval status), Pairing notifications, Start minimized.
- My device: Device name editing with byte validation, persistent cryptographic fingerprint display with clipboard copy.
- Permission activity: Live audit log resolving counterpart peer fingerprints to device names with expiry times.
- Permission defaults: Configurable default duration (until-revoked, 24 hours, 1 hour).
- Storage & inbox: Downloads location (`~/.lanvory/inbox`), integrity policy, and open inbox folder action.
- Keyboard shortcuts: Global navigation hotkeys (`⌘1`..`5` / `Ctrl+1`..`5`, `Esc`).
- Privacy & diagnostics: Strictly offline peer-to-peer statement, local SQLite database path, and sanitized diagnostic report export.
- About: App version, daemon build, protocol version, and open-source notices.

## Interactive Overview metrics and Discovery troubleshooting empty state (PROJECT_SPEC.md §38, §47)

- **Interactive Metric Tiles (§38)**:
  - Replaced passive dashboard metric divs with accessible, keyboard-interactive buttons in `apps/desktop/src/renderer/pages/devices.tsx`.
  - Clicking "Nearby devices" triggers on-demand discovery scan and focuses the nearby title.
  - Clicking "Trusted devices" smoothly scrolls to and focuses the paired devices panel (`#trusted-heading`).
  - Clicking "Shared services" routes to the Services page (`navigate('Services')`).
  - Clicking "Active transfers" routes to the Sharing page (`navigate('Sharing')`).
  - Styled `button.metric` with hover lift, focus rings, and reduced motion safety in `app.css`.
- **Discovery Empty State & Troubleshooting Guide (§47)**:
  - In `apps/desktop/src/renderer/features/devices/nearby.tsx`: When `devices.length === 0` after a scan, displays a structured troubleshooting checklist explaining that Lanvory must be active on the peer, both devices must be on the same Wi‑Fi/Ethernet subnet, local mDNS (UDP 5353) must be permitted, and re-emphasizing that Lanvory is 100% offline and peer-to-peer.
  - Retained exact DOM locators (`p.directory-empty`) and the existing manual "Pair by address" fallback action.

`pnpm typecheck`, `pnpm build`, `make verify`, and `sh scripts/smoke-native.sh pnpm` all passed on macOS arm64.

## Network diagnostics CLI & doctor expansion (PROJECT_SPEC.md §26)

- **Authenticated Peer Ping (`lanvory peer ping`)**:
  - Implemented `lanvory peer ping NAME IPv4:PORT FINGERPRINT [--json]` in `core/cmd/lanvory/main.go`.
  - Directly exercises the authenticated TLS handshake through the local daemon and measures millisecond round-trip latency (`latencyMs`), validating peer identity without exchanging application data.
- **Enhanced Doctor System Diagnostics (`lanvory doctor`)**:
  - Added checks for local SQLite database file existence, accessibility, and size (`state.sqlite3`).
  - Added filesystem check for the scoped local drop inbox (`~/.lanvory/inbox`).
  - Integrated live counts of trusted paired devices and registered local loopback services.
  - Formatted both human-readable status table and structured JSON report (`--json`).
- **Permission Activity Regression Alignment**:
  - Fixed summary label and event strong formatting in `apps/desktop/src/renderer/features/settings/permission-activity.tsx` to strictly match automated native smoke locators and assertions while retaining full visual styling.

`make verify` and both app-owned and external daemon passes of `sh scripts/smoke-native.sh pnpm` passed with code 0.

## Multi-file transfer support (PROJECT_SPEC.md §18)

Implemented batch multi-file selection, drag-and-drop, queue management, and sequential verified sending across Go CLI, Electron Main/Preload IPC, and Sharing UI:
- **Go CLI (`core/cmd/lanvory/main.go`)**:
  - Extended `lanvory files send NAME IPv4:PORT FINGERPRINT PATH...` to accept one or more file paths and send them sequentially over authenticated peer connections.
- **Electron Main & Preload (`apps/desktop/src/main/index.cjs`, `apps/desktop/src/preload/index.cjs`, `apps/desktop/src/shared/desktop-api.ts`)**:
  - Enabled `multiSelections` in `dialog.showOpenDialog` (capped at 50 files per batch per §18 maximum file count).
  - Added `lanvory:select-dropped-files` validating regular files (`lstatSync().isFile()`), absolute paths, and path length limits while rejecting symlinks and directories.
  - Added `lanvory:remove-selected-file` and `lanvory:selected-files` to allow removing individual files from a batch and syncing state after partial failure or cancellation.
  - Updated `lanvory:send-file` to send each queued file sequentially and remove completed items from the queue as they succeed.
- **Sharing UI (`apps/desktop/src/renderer/features/sharing/sharing.tsx`, `apps/desktop/src/renderer/styles/app.css`)**:
  - Displays selected file count (`N files selected`), a scrollable `.selected-files-list` with per-file remove buttons when multiple files are selected, and batch action labels (`Send N files`), while preserving exact single-file DOM locators.
- **Smoke Test (`apps/desktop/tests/native-smoke.cjs`)**:
  - Added automated coverage for multi-file picker selection, `.selected-files-list` rendering, individual item removal, and batch clearing.

`pnpm typecheck`, `make build`, `make verify` (with `BypassSandbox: true` for UDP/Unix socket tests), and `sh scripts/smoke-native.sh pnpm` all passed with exit code 0.

## Open verification gates

| Task | Available evidence | Missing evidence and prerequisites |
| --- | --- | --- |
| LAN-01, LAN-02, DROP-02, BRIDGE-03, SHARE-01 | `LOCALLY_VERIFIED` for the applicable macOS single-host and Linux container checks above | `PHYSICALLY_VERIFIED` on two authorized devices with WAN disconnected. Use the [LAN runbook](docs/development/lan-validation.md) for discovery, fallback, pairing, Drop, Bridge and revocation. |
| PERF-01 | Daemon recovery and transfer functionality have local coverage | Run the [measurement protocol](PROJECT_SPEC.md#mvp-acceptance-measurements). Local RSS, configuration and recovery measurements can proceed independently. LAN timing and throughput need two devices and the specified wired link. |
| MVP-01 | Ad hoc macOS arm64 artifact checks and native smoke | Complete §63 and record evidence for each MVP desktop baseline in the [compatibility matrix](PROJECT_SPEC.md#compatibility-matrix). |
| RELEASE-01 | `LOCALLY_VERIFIED` for ad hoc arm64 packaging and rejection of the unsigned artifact in release mode | `RELEASE_VERIFIED` requires authorized Developer ID and notary credentials and a successful release artifact smoke. |
| CI-01 | `LOCALLY_VERIFIED` for the macOS artifact and Linux core checks described above | Hosted workflow results require repository CI access and run links. The Linux core and macOS x64 jobs provide regression coverage outside MVP acceptance. |

Record each run's date, task and criterion, evidence level, OS build, CPU, session, artifact hash, procedure, raw measurements or logs, and result. Continue independent MVP work while external verification prerequisites are pending.

## Open work

- The two-device runbook now covers one-step LAN activation, shutdown with adapter revocation, reconnection with retained trust, file deselection, and the current Services flow. UI labels and CLI command syntax were checked against the renderer and local CLI help. The runbook still awaits execution on two physical devices.
- Run the [physical validation procedure](docs/development/lan-validation.md) with two devices and WAN disconnected. Record Bonjour and endpoint resolution, pairing and trust persistence, actual Drop approvals and checksums, Bridge relay and revocation, and preferred QUIC with TCP fallback. Only one macOS arm64 host was available here.
- Complete production hardening, settings, signing and packaging. Windows credential-store integration and native Linux desktop validation remain open. A Keychain authorization dialog may block daemon initialization until macOS resolves it.
- Observe a hosted macOS CI run and verify a Developer ID signed and notarized release. Review notices for new platforms or changed dependencies. No Git metadata was available in this workspace.

## Reproduce

See [README.md](README.md) for dependencies, build commands and launch. Use `make build`, `make verify`, and `sh scripts/smoke-identity.sh` in an interactive macOS login session. The desktop launch entry point is `make desktop`.

## Files

`core/`, `apps/desktop/`, `scripts/smoke-identity.sh`, `Makefile`, workspace manifests and lockfile, project instructions and design documents, and architectural, protocol and threat-model notes under `docs/`.

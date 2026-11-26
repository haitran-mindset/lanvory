# LANVORY — MASTER PROJECT DEVELOPMENT SPECIFICATION


## 01. ROLE

Act as a senior software engineering team consisting of:

- Principal Software Architect.
- Senior Network Engineer.
- Distributed Systems Engineer.
- Cybersecurity Engineer.
- Senior Go Developer.
- Senior Electron Developer.
- Senior React & TypeScript Developer.
- Senior UI/UX Designer.
- Product Designer.
- QA Automation Engineer.
- DevOps Engineer.

You are responsible for researching, designing, implementing, testing, optimizing, securing, and completing the entire Lanvory project.

You are an Autonomous Coding Agent, not just an advisory assistant.

You must directly:

- Analyze the repository.
- Create and edit source code.
- Install required dependencies.
- Execute terminal commands.
- Design architecture.
- Implement functionality.
- Build the user interface.
- Write automated tests.
- Run tests and builds.
- Analyze and fix bugs.
- Perform security checks.
- Write documentation.
- Complete the release workflow.

Do not stop at architecture proposals, pseudocode, project scaffolding, or UI prototypes.

---

## 02. PROJECT IDENTITY

### Project Name

Lanvory

### Product Category

Decentralized Local Network Platform.

### Tagline

Your devices. Your network. Your rules.

### Primary Headline

Your devices, connected locally.

### Secondary Headline

Local network, truly yours.

### Product Description

Lanvory is a decentralized, privacy-first desktop networking platform that enables devices on the same local network to discover each other, establish secure peer-to-peer connections, share files, synchronize folders, access local services, and collaborate without cloud infrastructure, central servers, accounts, or Internet access.

### Product Philosophy

- Local by design.
- Private by default.
- Peer-to-peer first.
- Zero cloud dependency.
- Zero account dependency.
- Zero central infrastructure.
- Device-owned identity.
- User-controlled permissions.
- Minimal configuration.
- Transparent networking.
- Native desktop experience.

Lanvory is not a VPN, not Cloud Storage, not a Tailscale clone, and not a network management app using a central server.

Lanvory is a platform for connecting and sharing resources between devices on the same local network.

---

## 03. NON-NEGOTIABLE REQUIREMENTS

These are mandatory architectural constraints.

### No Cloud

Do not use:

- AWS.
- Google Cloud.
- Azure.
- Firebase.
- Supabase.
- Cloud Database.
- Cloud Storage.
- Cloud Authentication.
- Cloud Messaging.
- Remote analytics services.
- Remote configuration services.

Do not add Cloud dependencies to simplify implementation.

### No Central Server

Do not build:

- Control Plane Server.
- Centralized Device Registry.
- Centralized Authentication Server.
- Signaling Server.
- Relay Server.
- TURN Server.
- STUN Server.
- Centralized API Server.
- Web Admin Dashboard.
- Centralized Database.

Each device is an independent peer with its own network listener to communicate with other peers.

Do not require a dedicated device to stay always online to manage other devices.

### No Account

Do not implement:

- Sign up.
- Sign in.
- Email authentication.
- OAuth.
- Auth0.
- Social login.
- Password reset.
- User account management.

Identity is generated and managed directly on each device.

### LAN Only

Only support connections through approved local network interfaces and local-network endpoints.

Do not implement:

- Internet P2P.
- NAT Traversal.
- UDP Hole Punching across the Internet.
- Public Relay.
- Public Tunnel.
- Public Port Forwarding.
- Remote Cloud Access.
- VPN Virtual IP.
- Exit Node.
- WireGuard Tunnel.

Enforce network scope validation and do not rely solely on private IP ranges to conclude an endpoint is safe.

Do not automatically communicate over VPN interfaces, public interfaces, or interfaces not approved by the user.

### No Internet Required

Runtime functionality must work when:

- The router has no Internet access.
- The Ethernet network has no Internet access.
- The local Wi-Fi has no Internet access.
- A Mobile Hotspot allows peer communication.

Fetching dependencies, developing software, and publishing updates may require Internet, but never make Internet a mandatory requirement to use the application.

### Local Data Ownership

All application data is stored locally on the device.

- Device identity.
- Private keys.
- Trusted peers.
- Application settings.
- Transfer history.
- Sync configuration.
- Shared services.
- Permissions.
- Activity logs.

Do not send data to external services.

---

## 04. PRODUCT DIFFERENTIATION

Lanvory may draw inspiration from LocalSend, Syncthing, KDE Connect, and Developer Tools, but must maintain its own product identity.

Do not build Lanvory merely as a File Transfer App.

Lanvory must combine:

1. Local Device Discovery.
2. Secure Peer-to-Peer Networking.
3. Trusted Device Ecosystem.
4. Local File Transfer.
5. Folder Synchronization.
6. Shared Clipboard.
7. Local Service Sharing.
8. Local Tunnel.
9. Network Diagnostics.
11. Device Collaboration.
12. Local Automation.
13. Local Backup.
14. Developer SDK.

Its differentiating value is providing a unified desktop workspace to manage and use resources across multiple devices on the same LAN.

---

## 05. REFERENCE PROJECTS

Study official repositories and documentation:

- LocalSend: https://github.com/localsend/localsend
- Syncthing: https://github.com/syncthing/syncthing
- KDE Connect: https://github.com/KDE/kdeconnect-kde
- go-libp2p: https://github.com/libp2p/go-libp2p
- quic-go: https://github.com/quic-go/quic-go
- mDNS: https://github.com/miekg/dns
- Zeroconf: https://github.com/grandcat/zeroconf
- fsnotify: https://github.com/fsnotify/fsnotify
- Automerge: https://github.com/automerge/automerge
- Magic Wormhole: https://github.com/magic-wormhole/magic-wormhole
- Electron: https://github.com/electron/electron
- xterm.js: https://github.com/xtermjs/xterm.js
- shadcn/ui: https://github.com/shadcn-ui/ui

Study additional RFCs related to:

- mDNS.
- DNS-SD.
- QUIC.
- TLS 1.3.
- Ed25519.
- Secure authentication.

Evaluate:

- Architecture.
- Protocol design.
- Security model.
- Dependency health.
- Maintenance status.
- License compatibility.
- Cross-platform support.

Do not copy source code or UI verbatim from reference products.

Check licenses before reusing any implementation.

---

## 06. TECHNOLOGY STACK

### Desktop Application

- Electron.
- React.
- TypeScript strict mode.
- Vite.
- Tailwind CSS.
- shadcn/ui primitives.
- Radix UI.
- Zustand.
- TanStack Query when appropriate.
- Zod.
- Lucide Icons.
- React Hook Form.
- Electron Builder.

Do not use Next.js for the desktop renderer unless there is a clear technical requirement.

### Network Core

- Go.
- quic-go.
- TLS 1.3.
- Ed25519.
- mDNS.
- DNS-SD.
- TCP/TLS fallback.
- Standard Go networking libraries.
- Context-based cancellation.
- Structured concurrency.

### Local Storage

- SQLite.
- Versioned database migrations.
- OS secure storage.
- Local filesystem.

Prefer an SQLite driver suitable for cross-platform packaging and avoid unnecessary native dependencies.

### Secure Storage

- macOS Keychain.
- Windows Credential Manager or DPAPI.
- Linux Secret Service or system-protected storage.

### Local IPC

- Unix Domain Socket on macOS/Linux.
- Named Pipe on Windows.
- Versioned typed protocol.
- Request/response.
- Event streaming.

### Additional Components

- fsnotify cho filesystem monitoring.
- SHA-256 or BLAKE3 for file integrity.
- React Flow for network visualization when needed.
- QR Code generation and scanning when hardware supports it.

### Development Tooling

- pnpm.
- Go modules.
- ESLint.
- Prettier.
- Vitest.
- Playwright.
- Go test.
- Go race detector.
- Go fuzz testing.
- Gitleaks.
- golangci-lint.
- govulncheck.
- GitHub Actions.

Use stable, maintained, and compatible dependencies.

Do not add frameworks merely because they are popular.

---

## 07. SYSTEM ARCHITECTURE

Lanvory uses a Fully Decentralized Peer Architecture.

Each device runs all components required for discovery, pairing, data transfer, and local permission management.

There is no central coordinator.

System topology:

```text
             LOCAL AREA NETWORK
┌────────────────────────────────────────┐
│                                        │
│  MacBook A ─────────── Windows B       │
│      │  ╲                 ╱  │         │
│      │   ╲               ╱   │         │
│      │    Raspberry Pi       │         │
│      │                       │         │
│  Mac Mini ─────────── Linux Server     │
│                                        │
└────────────────────────────────────────┘

No Cloud
No Central Server
No Internet Required
```

Connection edges represent direct peer communication capabilities and do not require maintaining continuous full-mesh connections.

### Architecture Layers

1. Presentation Layer.
2. Desktop Main Process.
3. Secure Local IPC Layer.
4. Application Service Layer.
5. Peer Networking Layer.
6. Security and Identity Layer.
7. Local Persistence Layer.
8. Operating System Integration Layer.

Desktop architecture:

```text
React Renderer
      |
Secure Preload API
      |
Electron Main Process
      |
Authenticated Local IPC
      |
Lanvory Core (Go)
      |
Application Services
      |
Peer Connection Manager
      |
QUIC / TLS Transport
      |
Local Network
```

### Architectural Principles

- Separation of concerns.
- Explicit dependencies.
- Modular monolith on each device.
- Transport abstraction.
- Platform abstraction.
- Event-driven state updates.
- Local-first persistence.
- No centralized coordination.
- No unnecessary microservices.

Do not deploy Kubernetes, Redis, message brokers, or distributed databases.

---

## 08. REPOSITORY STRUCTURE

Use a multi-language monorepo.

```text
lanvory/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   ├── renderer/
│       │   │   ├── app/
│       │   │   ├── components/
│       │   │   ├── features/
│       │   │   ├── layouts/
│       │   │   ├── pages/
│       │   │   ├── hooks/
│       │   │   ├── stores/
│       │   │   ├── services/
│       │   │   ├── styles/
│       │   │   ├── types/
│       │   │   └── assets/
│       │   └── shared/
│       ├── resources/
│       ├── tests/
│       └── package.json
│
├── core/
│   ├── cmd/
│   │   ├── lanvory/
│   │   └── lanvoryd/
│   ├── internal/
│   │   ├── app/
│   │   ├── daemon/
│   │   ├── identity/
│   │   ├── discovery/
│   │   ├── pairing/
│   │   ├── peer/
│   │   ├── transport/
│   │   ├── protocol/
│   │   ├── session/
│   │   ├── permissions/
│   │   ├── transfer/
│   │   ├── clipboard/
│   │   ├── sync/
│   │   ├── services/
│   │   ├── tunnel/
│   │   ├── messaging/
│   │   ├── automation/
│   │   ├── backup/
│   │   ├── diagnostics/
│   │   ├── networking/
│   │   ├── storage/
│   │   ├── keystore/
│   │   ├── ipc/
│   │   ├── events/
│   │   ├── config/
│   │   ├── logging/
│   │   └── platform/
│   │       ├── darwin/
│   │       ├── windows/
│   │       └── linux/
│   ├── migrations/
│   ├── tests/
│   └── go.mod
│
├── packages/
│   ├── protocol/
│   ├── ui/
│   ├── types/
│   ├── sdk/
│   ├── eslint-config/
│   └── typescript-config/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── network/
│   ├── security/
│   └── performance/
│
├── docs/
│   ├── architecture/
│   ├── protocols/
│   ├── security/
│   ├── design-system/
│   ├── development/
│   ├── user-guide/
│   └── decisions/
│
├── scripts/
├── .github/
│   └── workflows/
├── AGENTS.md
├── PROJECT_SPEC.md
├── ROADMAP.md
├── TASKS.md
├── HANDOFF.md
├── DESIGN_SYSTEM.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── PRIVACY.md
├── CHANGELOG.md
├── LICENSE
├── Makefile
├── package.json
├── pnpm-workspace.yaml
└── .gitignore
```

This is the target structure.

Only create modules when actual implementations exist. Do not create batches of empty folders, interfaces, or unused abstractions.

---

## 09. NETWORK DAEMON

Background process name:

`lanvoryd`

The daemon is responsible for networking, local storage, identity, security, and background services.

### Requirements

- Operate independently from the renderer.
- Background execution.
- Network interface monitoring.
- Device discovery.
- Peer connection management.
- Secure pairing.
- Permission enforcement.
- File transfer.
- Folder synchronization.
- Shared service management.
- Persistent local state.
- Graceful shutdown.
- Crash recovery.
- Reconnection.
- Event streaming.
- Diagnostics.
- Local IPC.
- Resource cleanup.

Prefer running the daemon under normal user privileges.

Do not require administrator or root privileges for functionality that does not need elevated permissions.

### Lifecycle

```text
STOPPED
STARTING
INITIALIZING
DISCOVERING
READY
DEGRADED
STOPPING
ERROR
```

### Daemon Management

Must handle:

- Electron starting before the daemon.
- The daemon starting before Electron.
- Daemon crash recovery.
- Duplicate daemon process.
- Application restart.
- IPC disconnect.
- Network change.
- Computer sleep/wake.
- Application shutdown.

Prevent multiple daemon instances from sharing the same database or identity unsafely.

---

## 10. DEVICE IDENTITY

Each device generates its own identity on first launch.

No user account is required.

### Device Identity Includes

- Stable device ID.
- Device public key.
- Device fingerprint.
- Device name.
- Hostname.
- Operating system.
- Application version.
- Protocol version.
- Created timestamp.

Use Ed25519 for long-term device identity.

Device ID should be deterministically derived from the public key in a versioned format.

Do not use MAC address, IP address, or hardware serial number as a security identity.

### Private Keys

- Generated locally.
- Uses a cryptographically secure random generator.
- Not exported by default.
- Not transmitted to peers.
- Never appears in logs.
- Never appears in the renderer.
- Never stored as plaintext in SQLite.

Identity must be protected by appropriate OS secure storage.

If secure storage is unavailable, a fallback mechanism must be explicitly designed, explained, and tested; never silently downgrade security.

Device identity must remain stable when IP or hostname changes.

Identity reset must require explicit user confirmation.

---

## 11. LOCAL DEVICE DISCOVERY

Use mDNS and DNS-SD as the primary discovery mechanism.

Service type:

`_lanvory._udp.local.`

When using TCP fallback, register the corresponding service type:

`_lanvory._tcp.local.`

### Announcement Metadata

For example:

```json
{
  "deviceId": "device-fingerprint",
  "protocolVersion": 1,
  "appVersion": "0.1.0",
  "capabilities": ["pairing", "transfer"]
}
```

Publish only the minimum metadata required.

Do not include secrets, tokens, file paths, permissions, or sensitive information in mDNS TXT records.

Hostname and device display name must have appropriate privacy settings.

### Discovery Features

- Automatic peer discovery.
- Service announcement.
- Service browsing.
- Service removal.
- Duplicate detection.
- Device presence.
- Device timeout.
- Network interface filtering.
- IPv4 support.
- IPv6 local connectivity when appropriate.
- Multiple interface handling.
- Manual endpoint discovery.
- Discovery retry.
- Refresh discovery.

Discovery does not equal authentication.

Every discovered peer is untrusted until pairing succeeds.

### Network Changes

Must handle:

- Wi-Fi switching.
- Ethernet connection.
- DHCP address change.
- Interface removal.
- Sleep and wake-up.
- Multiple network adapters.
- VPN interface presence.
- Network disconnection.

### Discovery Fallback

If mDNS is blocked while two devices can still connect directly, support manual pairing using local IP and port.

Do not perform aggressive subnet scanning by default.

Do not bypass client isolation or network security policies.

---

## 12. SECURE DEVICE PAIRING

Do not automatically trust devices merely because they appear on the same LAN.

### Pairing Methods

- Numeric verification code.
- QR Code.
- Public key fingerprint verification.
- Manual endpoint pairing.

### Pairing Flow

1. Device A discovers Device B.
2. User selects Pair Device.
3. Device A sends a pairing request.
4. Device B displays the incoming request.
5. Both devices perform a secure handshake.
6. Both sides verify identity via fingerprint or short authentication string.
7. Users confirm the information matches.
8. Both sides save the trusted public key.
9. Establish an authenticated secure session.
10. Apply default permissions.

The verification code must be bound to the cryptographic handshake transcript and the identities of both devices.

Do not transmit a PIN over an unauthenticated connection and treat it as MITM protection.

If implementing pairing with a low-entropy secret, use PAKE or a proven pairing protocol.

A QR Code may contain a public key fingerprint, endpoint, and time-limited pairing challenge.

### Requirements

- Explicit user consent.
- Pairing expiration.
- Replay protection.
- Rate limiting.
- Retry limits.
- Pairing cancellation.
- Duplicate request handling.
- MITM resistance.
- Public key pinning.
- Trust persistence.
- Trust revocation.
- Re-pairing.
- Key-change detection.

When a trusted device's public key changes, do not automatically accept the new key.

Require the user to re-verify and re-pair, or use an authenticated key rotation mechanism.

---

## 13. SECURE P2P TRANSPORT

Use QUIC as the preferred peer transport.

Implementation:

- quic-go.
- TLS 1.3.
- Mutual device authentication.
- Pinned peer identity.
- ALPN protocol negotiation.
- Multiplexed streams.

Use TCP with TLS as a fallback if UDP is unavailable.

Fallback must only occur within the local network and must preserve the same security guarantees.

### Transport Responsibilities

- Connection establishment.
- Peer authentication.
- Session management.
- Stream multiplexing.
- Connection timeout.
- Keepalive.
- Heartbeat.
- Reconnection.
- Flow control.
- Backpressure.
- Message size limits.
- Concurrent stream limits.
- Resource limits.
- Graceful shutdown.
- Cancellation.

Use TLS certificates properly bound to device identity and verify trust using the paired key.

Do not use `InsecureSkipVerify` to bypass authentication unless full custom verification is implemented and security-reviewed.

Do not invent custom encryption algorithms.

Do not use fixed encryption keys or hardcoded secrets.

Disable 0-RTT for replayable operations unless proper replay protection is in place.

### Transport Abstraction

Application modules must not depend directly on the QUIC implementation.

Create a transport abstraction sufficient to support:

- QUIC.
- TCP/TLS.
- Test transport.
- Future local transport.

Maintaining simultaneous connections to all peers is not required.

On-demand connections and idle timeouts may be used.

---

## 14. PEER PROTOCOL

Design a versioned application protocol.

### Protocol Envelope

```json
{
  "version": 1,
  "requestId": "unique-request-id",
  "type": "peer.info",
  "payload": {}
}
```

Sender identity must be derived from the authenticated transport session; never trust an arbitrary `senderId` sent by a client in the payload.

### Protocol Features

- Version negotiation.
- Capability negotiation.
- Request/response.
- Event notifications.
- Error codes.
- Request cancellation.
- Timeout.
- Payload validation.
- Maximum frame size.
- Backpressure.
- Compatibility checks.
- Unknown message handling.

### Message Categories

```text
peer.info
peer.capabilities
peer.ping
peer.pong

pair.request
pair.confirm
pair.reject
pair.cancel

transfer.offer
transfer.accept
transfer.reject
transfer.chunk
transfer.progress
transfer.complete
transfer.cancel

clipboard.offer
clipboard.accept
clipboard.update

sync.manifest
sync.request
sync.chunk
sync.conflict

service.list
service.connect
service.disconnect

message.send
message.ack
```

Use appropriate protocol framing for binary streams.

JSON is not required for file data or all network packets.

Large binary payloads must be streamed rather than Base64-encoded in full.

Write protocol documentation and compatibility tests.

---

## 15. TRUST MODEL & PERMISSIONS

Lanvory uses a per-device trust model.

Trusted peers are not granted all access permissions by default.

### Trust States

- Discovered.
- Untrusted.
- Pairing.
- Trusted.
- Blocked.
- Revoked.

Online/offline is a presence state, not a trust state.

### Permission Categories

- Send files.
- Receive files.
- Clipboard sharing.
- Folder synchronization.
- Access shared services.
- Local tunnel.
- Local messaging.
- Backup.
- Automation.

### Permission Requirements

- Default-deny cho sensitive functionality.
- Per-peer permissions.
- Per-resource permissions.
- User-controlled permissions.
- Temporary permission grants.
- Permission expiration.
- Revocation.
- Incoming request approval.
- Audit events.
- Active session cancellation.

Each device must enforce access permissions for its own resources.

There is no global admin role or centralized ACL.

Trust between A and B does not mean B can vouch for A to trust C.

Do not automatically propagate trust across devices.

A revoked trusted device must have related active sessions terminated and must not retain resource access without re-pairing.

---

## 16. LOCAL DATABASE

Use SQLite.

### Database Entities

- LocalDevice.
- TrustedPeers.
- PeerEndpoints.
- PeerPermissions.
- PairingHistory.
- Transfers.
- TransferItems.
- TransferChunks.
- SharedFolders.
- SyncPeers.
- SyncEntries.
- SyncVersions.
- SyncConflicts.
- SharedServices.
- ServicePermissions.
- TunnelSessions.
- ClipboardSettings.
- LocalMessages.
- AutomationRules.
- BackupJobs.
- ActivityEvents.
- ApplicationSettings.
- SchemaMigrations.

Only create tables when the corresponding feature actually needs them.

### Database Requirements

- Database migrations.
- Transaction safety.
- Foreign keys.
- Unique constraints.
- Proper indexing.
- Parameterized queries.
- Concurrent access handling.
- Crash recovery.
- Configurable retention.
- Backup and restore.
- Safe schema upgrades.

Do not store:

- Raw private keys.
- Plaintext authentication secrets.
- Sensitive clipboard history by default.
- Unnecessary file contents.

Full SQLite encryption is not mandatory if OS-level protection and the threat model do not require it, but sensitive data must be protected appropriately.

---

## 17. DEVICE MANAGEMENT

### Devices Screen

Display:

- Device name.
- Device type.
- Operating system.
- Hostname.
- Local IP.
- Trust status.
- Connection status.
- Last seen.
- Protocol version.
- Application version.
- Supported capabilities.
- Connection transport.
- Measured latency when available.

### Device Actions

- Pair device.
- Cancel pairing.
- Rename local alias.
- View details.
- Copy IP.
- Copy fingerprint.
- Ping.
- Send files.
- Request service access.
- Manage permissions.
- Block.
- Unpair.
- Forget device.

### Device Details

- Identity fingerprint.
- Public key information.
- Local endpoint.
- Connection statistics.
- Last connection.
- Permissions.
- Shared resources.
- Recent activity.

Do not display fake latency or fake online status.

Distinguish between:

- Discovered.
- Reachable.
- Authenticated.
- Connected.
- Offline.

---

## 18. FILE TRANSFER — LANVORY DROP

Build secure peer-to-peer file transfer.

### Features

- Single-file transfer.
- Multi-file transfer.
- Folder transfer.
- Drag and drop.
- Incoming transfer confirmation.
- Transfer queue.
- Bounded parallel transfers.
- Progress.
- Speed.
- Estimated remaining time.
- Cancel.
- Retry.
- Pause/resume when supported by the protocol.
- Transfer history.
- Destination selection.
- Open received folder.
- Integrity verification.

### Transfer Flow

1. Sender selects file.
2. Sender selects trusted peer.
3. Sender creates transfer manifest.
4. Receiver receives transfer offer.
5. Receiver approves or declines.
6. Check disk availability and permissions.
7. Stream file chunks.
8. Verify integrity.
9. Finalize file at destination.
10. Record result.

### Security Requirements

- Path traversal prevention.
- Absolute path rejection.
- Symlink protection.
- Filename sanitization.
- Reserved filename handling.
- Unicode filename handling.
- Maximum file size.
- Maximum file count.
- Rate limiting.
- Concurrent transfer limits.
- Safe temporary files.
- Disk-space checks.
- File overwrite confirmation.
- Archive-bomb protection if archives are supported.
- Integrity verification.

Do not automatically execute received files.

Do not automatically write files to arbitrary filesystem locations.

Use temporary files and atomic completion when supported by the filesystem.

### Resume Protocol

Support resume via transfer ID and verified chunk information.

Verify the source file has not changed before resuming a transfer.

Do not require reading the entire file into memory.

Test large files, interruptions, and network reconnects.

---

## 19. FOLDER SYNCHRONIZATION — LANVORY SYNC

Build decentralized folder synchronization.

### Sync Modes

- Send only.
- Receive only.
- Bidirectional.
- Manual sync.
- Continuous sync.
- Scheduled local sync.

### Requirements

- Filesystem monitoring.
- Initial directory scan.
- Periodic reconciliation.
- Change detection.
- File metadata.
- Content hashing.
- Incremental transfer.
- Chunk-based synchronization when appropriate.
- Rename detection when feasible.
- Conflict detection.
- Conflict copies.
- Deletion handling.
- Ignore patterns.
- Sync history.
- Pause/resume.
- Bandwidth limits.
- Offline peer handling.
- Retry.
- Rescan.

Do not rely on modification timestamps as the sole source of truth.

Design version vectors or an appropriate version-tracking mechanism to detect concurrent changes.

Do not blindly apply CRDTs to arbitrary binary files.

### Conflict Handling

For example:

```text
document.md
document.conflict-macbook-20261120.md
```

Do not silently overwrite user changes on concurrent modifications.

Clearly surface conflicts and support resolution.

### Deletion Safety

- Explicit deletion policy.
- Tombstones.
- Version history or trash strategy.
- Mass-deletion warning.
- Protection against accidental destructive sync.

Do not automatically sync every folder on the machine.

Only sync user-selected folders with authorized peers.

---

## 20. SHARED CLIPBOARD

Allow clipboard sharing between trusted devices.

### Supported Data

- Plain text.
- URLs.
- Images theo roadmap.
- Files or rich content after appropriate security design.

### Requirements

- Disabled by default.
- Per-peer opt-in.
- Manual send.
- Optional automatic synchronization.
- Clipboard size limit.
- Duplicate detection.
- Loop prevention.
- Clipboard history disabled by default.
- Sensitive content controls.
- Explicit permission.
- Pause synchronization.

Do not automatically broadcast clipboard contents to all peers.

Do not automatically paste or execute clipboard contents from a remote peer.

Implement loop prevention:

Device A updates B → B updates A → repeated synchronization.

Do not claim to accurately detect every password or secret in the clipboard.

Allow users to restrict data types and disable the feature when needed.

---

## 21. LOCAL SERVICE SHARING — LANVORY BRIDGE

Allow users to share local services with trusted devices.

For example:

- Next.js development server.
- React development server.
- NestJS API.
- PostgreSQL.
- Redis.
- Local documentation server.
- Local development tools.

### Example

Machine A:

```text
Next.js application
127.0.0.1:3000
```

Machine B accesses it via a local endpoint:

```text
127.0.0.1:13000
```

Traffic flow:

```text
Machine B
Local Browser
      |
127.0.0.1:13000
      |
Lanvory Secure Tunnel
      |
Machine A
      |
127.0.0.1:3000
```

Do not require the Next.js application to change its binding to `0.0.0.0`.

### Service Configuration

- Service name.
- Target address.
- Target port.
- Protocol.
- Description.
- Allowed peers.
- Expiration.
- Access policy.
- Active sessions.
- Local listening address.

### Security

Do not publish arbitrary ports automatically.

Only explicitly user-created services are accessible.

Remote peers must not supply arbitrary destination addresses to turn Lanvory into a general-purpose proxy.

Do not support unrestricted remote network scanning or internal network pivoting.

Service forwarding must be restricted to registered resources.

Do not allow access to Cloud metadata endpoints or addresses outside the defined scope.

The local proxy on the receiving device must bind to loopback by default.

Do not bypass authentication of underlying services.

---

## 22. LOCAL TUNNEL

Build TCP stream forwarding over authenticated peer connections.

### Requirements

- Local port forwarding.
- Stream multiplexing.
- Per-service authorization.
- Local loopback binding.
- Automatic port allocation.
- Port conflict detection.
- Bidirectional streaming.
- Connection timeout.
- Idle timeout.
- Session cancellation.
- Resource limits.
- Connection statistics.
- Graceful shutdown.

### Flow

```text
Client Application
        |
Local Listener
        |
Authenticated QUIC Stream
        |
Remote Lanvory Peer
        |
Approved Local Service
```

QUIC encryption only protects the segment between Lanvory peers.

Clearly document the trust boundary between the local application, tunnel endpoints, and target service.

Do not claim Lanvory is a system-wide VPN.

Do not use TUN/TAP interfaces without an explicit new requirement approved by the user.

---

## 24. LOCAL MESSAGING

Build lightweight local messaging.

### Features

- One-to-one messaging.
- Text messages.
- Message timestamps.
- Delivery status.
- Unread messages.
- Local message history.
- Offline message queue.
- Retry.
- Local message deletion.
- Conversation permission.

Message delivery only occurs when both peers can connect.

Do not implement cloud store-and-forward.

Do not assume messages saved on another device can be deleted.

Message payloads must travel over authenticated encrypted transport.

This is a roadmap feature and must not delay the networking foundation.

---

## 25. NETWORK EXPLORER

Build a dedicated network visualization for Lanvory.

### Requirements

- Current device.
- Discovered peers.
- Trusted peers.
- Active connections.
- Offline peers.
- Shared service relationships.
- Active sync relationships.
- Connection transport.
- Measured latency.
- Network interface information.

Visualization must only reflect actual information known to the local node.

Do not infer physical router topology or connections between two remote peers without data.

Do not use fake graph edges.

The network graph must serve connection understanding, not decorative animation.

---

## 26. NETWORK DIAGNOSTICS

Build diagnostics tools.

### Information

- Local network interfaces.
- Local IP addresses.
- Subnet information.
- Active discovery interface.
- mDNS service status.
- QUIC listener status.
- TCP fallback status.
- Device fingerprint.
- Peer connection state.
- Connection uptime.
- Measured latency.
- Bytes sent.
- Bytes received.
- Active streams.
- Transfer throughput.
- Firewall-related errors when identifiable.

### Diagnostic Actions

- Refresh discovery.
- Peer ping.
- Test authenticated connection.
- Test approved service connectivity.
- Inspect local listener.
- Export sanitized diagnostic report.
- Restart networking.
- Reset discovery.

Do not fabricate networking metrics.

Do not automatically scan the entire LAN.

Do not automatically modify firewall configuration.

---

## 27. LOCAL AUTOMATION

Design a local rule-based automation engine.

### Trigger Examples

- Trusted peer online.
- Trusted peer offline.
- Network connected.
- File transfer completed.
- Sync conflict detected.
- Shared service available.
- Scheduled local time.

### Allowed Actions

- Start approved sync.
- Start approved backup.
- Send local notification.
- Queue approved file transfer.
- Open predefined application link.
- Update local application state.

### Example

When MacBook joins the home LAN:

- Detect Mac Mini.
- Verify trusted identity.
- Start configured folder synchronization.
- Show progress.
- Notify upon completion.

Do not allow remote peers to send arbitrary executable automation.

Do not execute arbitrary shell scripts by default.

Automation must be created, inspected, enabled, and revoked locally by the user.

---

## 28. LOCAL BACKUP

Allow backing up data to a trusted device.

### Features

- Manual backup.
- Scheduled backup.
- Incremental backup.
- Backup destination approval.
- Versioned snapshots.
- Backup retention.
- Integrity verification.
- Restore preview.
- Restore confirmation.
- Backup history.
- Disk quota.
- Backup cancellation.

Distinguish between Backup and Folder Sync.

Folder Sync may synchronize deletions.

Backup must be designed to protect data from accidental deletion or corruption.

Do not claim backup is safe without testing restore.

---

## 29. CLI APPLICATION

CLI name:

`lanvory`

The CLI communicates with the local daemon over secure IPC.

### Core Commands

```bash
lanvory start
lanvory stop
lanvory restart
lanvory status

lanvory devices
lanvory devices --json

lanvory discover
lanvory pair <device>
lanvory unpair <device>
lanvory ping <device>

lanvory identity
lanvory identity fingerprint

lanvory send <file> --to <device>
lanvory transfers list
lanvory transfers cancel <id>

lanvory sync list
lanvory sync pause <id>
lanvory sync resume <id>

lanvory services list
lanvory services share --port 3000
lanvory services stop <id>

lanvory tunnel open <service>
lanvory tunnel close <id>

lanvory network
lanvory doctor
lanvory logs

lanvory version
lanvory help
```

### Requirements

- Human-readable output.
- JSON output.
- Correct exit codes.
- Help documentation.
- Shell completion when appropriate.
- Input validation.
- Timeout.
- Secure IPC.
- No plaintext secrets.

Sensitive operations must still follow the trust model and user consent.

The CLI must not bypass Desktop Application permissions.

---

## 30. LOCAL IPC

The Electron Main Process and CLI communicate with the Go daemon over local IPC.

### Requirements

- Unix socket permissions.
- Windows Named Pipe ACL.
- OS-level peer authentication when feasible.
- Request ID.
- Versioning.
- Typed contracts.
- Error codes.
- Request cancellation.
- Timeout.
- Event streaming.
- Message size limits.
- Input validation.

### IPC Methods

```text
daemon.status
daemon.start
daemon.stop

identity.get
identity.fingerprint

devices.list
devices.get
devices.pair
devices.unpair
devices.block
devices.ping

permissions.list
permissions.update

transfers.create
transfers.accept
transfers.reject
transfers.cancel
transfers.list

sync.create
sync.pause
sync.resume
sync.list

services.create
services.remove
services.list

tunnels.open
tunnels.close

network.status
network.refresh

settings.get
settings.update

events.subscribe
```

Do not expose the privileged IPC server over a public TCP interface.

Do not allow the Electron renderer to access the raw IPC socket.

IPC permissions must be verified by the daemon.

---

## 31. DESKTOP APPLICATION STRUCTURE

Lanvory must be a desktop application, not a website wrapped in Electron.

### Main Process Responsibilities

- Window lifecycle.
- Daemon lifecycle.
- Tray integration.
- Native menus.
- Application shortcuts.
- File picker.
- Directory picker.
- Native notifications.
- Secure storage integration.
- IPC bridge.
- OS integration.

### Preload Responsibilities

- Restricted context bridge.
- Typed API exposure.
- Input validation.
- Event subscription.
- Listener cleanup.

### Renderer Responsibilities

- Visual presentation.
- User interactions.
- Application navigation.
- State rendering.
- Forms.
- Notifications.
- Accessibility.

Do not implement network daemon logic inside React components.

Do not allow the renderer to directly access the filesystem, shell, OS credentials, or arbitrary Node.js APIs.

### Electron Security

- `contextIsolation: true`.
- `nodeIntegration: false`.
- `sandbox: true` when appropriate.
- Strict Content Security Policy.
- Sender validation.
- Navigation restrictions.
- External URL validation.
- Restricted window creation.
- No arbitrary shell execution.
- No remote HTML loading.

---

## 32. PRODUCT DESIGN DIRECTION

Design Lanvory based on the style of:

**Retro Terminal × Editorial Minimalism × Native Desktop Utility**

Refer to the Lanvory reference image provided in the project context.

If a reference image exists in the repository, read and use it as visual direction.

Do not copy a layout verbatim if that layout is landing-page-oriented.

### Design Characteristics

- Dark monochrome.
- Warm charcoal surfaces.
- Monospace typography.
- Strong typographic hierarchy.
- Flat surfaces.
- Thin borders.
- Subtle dotted-grid texture.
- Restrained accent colors.
- Compact desktop density.
- Practical information architecture.
- Independent product identity.
- Native desktop application behavior.

### Overall Design Language

The interface must feel intentionally crafted by a product designer, focusing on functional hierarchy, pixel alignment, and typography.

Do not create a generic AI dashboard.

### Design References

You may study the design ethos of:

- Linear.
- Raycast.
- Zed.
- Ghostty.
- Things.
- GitHub Desktop.
- Native macOS utilities.
- Classic terminal applications.
- Swiss typography.
- Editorial layout.

Do not clone any product.

---

## 33. ANTI-GENERIC AI DESIGN RULES

This section is mandatory for the entire UI.

### Avoid

- Excessive gradient backgrounds.
- Neon glow on every component.
- Glassmorphism.
- Floating glass cards.
- Oversized rounded cards.
- Bento grid on every screen.
- Generic dashboard templates.
- Large landing-page hero occupying most of the desktop workspace.
- Unnecessary decorative illustrations.
- Generic globe illustration.
- AI-style futuristic network graphics.
- Excessive shadows.
- Multiple competing accent colors.
- Gradient text.
- Unnecessary animations.
- Random decorative status pills.
- Excessive whitespace with no functional purpose.
- Duplicate information.
- Large marketing copy on functional screens.
- Fake charts.
- Fake statistics.
- Excessive use of badges.
- Uncustomized default shadcn/ui appearance.

### Prefer

- Strong alignment.
- Deliberate typography.
- Compact data rows.
- Native-like toolbar.
- Simple segmented navigation.
- Sharp visual hierarchy.
- Thin dividers.
- Small corner radius.
- Contextual actions.
- Selection states.
- Inspector panels.
- Functional status bar.
- Keyboard shortcuts.
- Small amounts of purposeful texture.
- Meaningful empty states.
- Real operational data.

### Important

Do not over-complicate the UI merely to prove it does not look AI-generated.

Do not use Victorian, royal luxury, or ornamental gold UI styles.

Refinement must come from typography, restraint, layout, and attention to detail.

---

## 34. DESIGN SYSTEM

Create `DESIGN_SYSTEM.md`.

Design the entire UI using semantic design tokens.

### Dark Theme

Suggested palette:

```css
:root {
  --background: #101111;
  --sidebar: #131414;
  --surface: #171818;
  --surface-hover: #1d1f1f;
  --surface-selected: #252827;

  --border: #292c2b;
  --border-strong: #383c3a;

  --foreground: #e9eae7;
  --foreground-secondary: #a0a5a1;
  --foreground-muted: #747a76;

  --accent: #a8bca7;

  --success: #73b88a;
  --warning: #d0ab70;
  --danger: #c97878;

  --focus-ring: #a8bca7;
}
```

Use accent colors purposefully.

Green is reserved primarily for active network, connected state, and operational status.

Do not flood the entire UI with neon green.

Check contrast and accessibility before finalizing the palette.

### Typography

Preferred fonts:

- IBM Plex Mono.
- Geist Mono.
- JetBrains Mono.
- Inter.
- System UI fonts.

Use monospace for:

- IP addresses.
- Fingerprints.
- Port numbers.
- Device metadata.
- Technical labels.
- Status bar.

Use sans-serif or monospace purposefully for section headings and body text.

Do not use an overly dense monospace font that reduces readability.

Fonts must be bundled locally with proper licenses.

Do not load Google Fonts at runtime.

### Suggested Type Scale

```text
Page title:       24–28px
Section title:    15–18px
Primary text:     13–14px
Secondary text:   12–13px
Technical label:  11–12px
Status text:      11–12px
```

Oversized italic typography should only be used in onboarding or welcome states when appropriate.

Do not use marketing font sizes on every functional screen.

### Spacing

```text
4px
8px
12px
16px
20px
24px
32px
40px
```

### Border Radius

```text
Small:  4px
Medium: 6px
Large:  8px
Dialog: 10px
```

Use pill shapes only when truly appropriate for the component.

### Borders

- 1px subtle borders.
- Clear selected row state.
- Minimal shadow.
- No glowing borders.

### Motion

- 100–180ms transitions.
- Subtle hover.
- Functional progress indicators.
- Reduced-motion support.
- No looping decorative animation.

---

## 35. BRAND IDENTITY & LOGO

Design a dedicated logo for Lanvory.

The logo must:

- Simple.
- Geometric.
- Recognizable at small sizes.
- Monochrome-compatible.
- Suitable for macOS Menu Bar.
- Suitable for Windows System Tray.
- Suitable for application icon.
- Suitable for dark/light appearance.

### Logo Concept

Prefer a geometric monogram based on the letter L, combined with two or three directly connected nodes.

The logo must convey:

- Local connectivity.
- Peer-to-peer.
- Decentralization.
- Independence.

Do not use:

- Generic AI atom icon.
- OpenAI-like knot.
- Generic glowing hexagonal mesh.
- Random 3D cube.
- Generic shield-only icon.
- Stock network logo.

The primary logo should use flat vector geometry.

Prepare:

- Logo SVG.
- Monochrome symbol.
- Horizontal wordmark.
- App icon.
- Tray icon.
- Dark theme variant.
- Light theme variant.
- Windows ICO.
- macOS ICNS.
- PNG assets.

Test the logo at 16px, 24px, 32px, 64px, and 512px.

Do not claim exclusive trademark or logo rights without legal clearance.

---

## 36. DESKTOP WINDOW LAYOUT

The desktop layout must feel like an everyday utility application.

### Layout Structure

```text
┌────────────────────────────────────────────────────┐
│ Native Title Bar                    Search   Menu  │
├───────────┬────────────────────────────┬───────────┤
│           │ Page Toolbar               │           │
│ Sidebar   ├────────────────────────────┤ Inspector │
│           │                            │           │
│ Navigation│ Main Workspace             │ Selected  │
│           │                            │ Device    │
│           │                            │ Details   │
├───────────┴────────────────────────────┴───────────┤
│ LAN Active | Local IP | Peers | Encryption | Version│
└────────────────────────────────────────────────────┘
```

### Suggested Dimensions

- Sidebar: 190–220px.
- Inspector: 260–320px.
- Main toolbar: 44–52px.
- Title bar: platform-appropriate.
- Status bar: 24–30px.
- Main content: responsive.

Desktop minimum dimensions must be determined after testing with real content.

The sidebar can collapse.

The inspector can be toggled open or closed.

Screens must use space efficiently.

Do not show the inspector when nothing is selected.

### Native Window Controls

macOS uses native traffic-light controls appropriately.

Windows uses minimize, maximize, close.

Do not show both sets of window controls on the same platform.

Prefer native desktop behavior.

---

## 37. NAVIGATION

### Primary Navigation

```text
WORKSPACE
  Overview
  Devices
  Sharing
  Sync
  Services

TOOLS
  Network
  Diagnostics

SYSTEM
  Activity
  Settings
```

Add feature entries when the corresponding functionality is implemented.

Do not put unimplemented features into primary navigation merely to make the UI look full.

### Sidebar Requirements

- Compact logo and wordmark.
- Active navigation indicator.
- Functional icons.
- Navigation groups.
- Keyboard accessibility.
- Collapsible behavior.
- Local network status.
- Application settings access.

Do not let a large logo occupy most of the sidebar.

---

## 38. OVERVIEW SCREEN

Overview is an operational dashboard, not a landing page.

### Content

- This device.
- Current network interface.
- Local IP.
- Discovery status.
- Trusted devices.
- Active transfers.
- Active syncs.
- Shared services.
- Recent activity.
- Pending pairing requests.

### Design

Use compact information sections.

Inline metrics may be used:

```text
04 devices online    03 trusted    02 active syncs
```

Do not force every metric into its own card.

Only use charts when historical data and a clear purpose exist.

Welcome headlines should only appear selectively during initial onboarding or when no paired device exists.

---

## 39. DEVICES SCREEN

This is one of the most important screens.

### Toolbar

- Devices title.
- Search.
- Filter.
- Refresh discovery.
- Pair Device button.

### Filters

- All.
- Nearby.
- Trusted.
- Connected.
- Offline.
- Blocked.

### Device List

Suggested columns:

```text
Device
Address
Trust
Status
Latency
Actions
```

Selected row opens the inspector.

### Device Inspector

- Device name.
- Device platform.
- Device fingerprint.
- IP address.
- Trust state.
- Connection transport.
- Last seen.
- Capabilities.
- Permissions.
- Quick actions.

### Quick Actions

- Send files.
- View shared services.
- Manage permissions.
- Ping.
- Copy address.

Do not display actions if the peer lacks support or the user lacks permission.

Explain disabled states when needed.

---

## 40. SHARING SCREEN

### Layout

- Transfer drop zone.
- Recipient selection.
- Incoming transfers.
- Outgoing transfers.
- Active transfers.
- Completed transfers.
- Failed transfers.

### Transfer Row

- Filename.
- File size.
- Destination/source.
- Progress.
- Transfer speed.
- Status.
- Cancel/retry action.

Display incoming requests using native or in-app notifications appropriately.

Do not automatically accept incoming files by default.

---

## 41. SYNC SCREEN

### Layout

- Shared folders list.
- Connected peers.
- Sync direction.
- Sync status.
- Last synchronized time.
- Pending changes.
- Conflicts.
- Pause/resume actions.

### Folder Detail

- Local path.
- Remote peer.
- Sync mode.
- Ignore patterns.
- Permissions.
- Synchronization history.
- Conflict list.
- Manual rescan.

Do not display the remote device's local file path unless the peer explicitly shares it.

---

## 42. SERVICES SCREEN

### Layout

- My shared services.
- Available peer services.
- Active tunnel sessions.

### Service Row

```text
Name
Device
Protocol
Port
Status
Access
```

### Service Creation Form

- Service name.
- Target host.
- Target port.
- Allowed peers.
- Expiration.
- Description.

Display warnings if the local target is unreachable.

Do not directly expose ports to the public network.

---

## 44. NETWORK SCREEN

### Layout

- Local network details.
- Peer topology visualization.
- Active connections.
- Network interface selection.
- Connection details.

Use a purposeful dotted-grid background on the network visualization canvas.

The visual graph must serve a technical purpose; do not use spheres or decorative particles.

### Graph Interactions

- Select node.
- Inspect peer.
- Zoom.
- Pan.
- Filter trusted devices.
- Filter active connections.
- Refresh.

---

## 45. ACTIVITY SCREEN

Display local activity history:

- Device discovered.
- Pairing requested.
- Device paired.
- Device unpaired.
- Peer connected.
- Peer disconnected.
- File transfer completed.
- Transfer failed.
- Sync conflict.
- Service shared.
- Tunnel opened.
- Permission changed.

### Requirements

- Search.
- Event type filters.
- Time filters.
- Configurable retention.
- Export sanitized logs.
- Clear local history.

Do not store sensitive payloads in activity events.

---

## 46. SETTINGS SCREEN

### General

- Device display name.
- Launch at startup.
- Start minimized.
- Language.
- Notifications.

### Appearance

- Dark.
- Light.
- System.
- Font size.
- Reduced motion.
- Interface density.

### Network

- Enable local discovery.
- Allowed network interfaces.
- Connection port.
- Manual discovery.
- Network diagnostics.

### Security

- Device fingerprint.
- Trusted devices.
- Pairing preferences.
- Permission defaults.
- Blocked peers.
- Identity reset.

### Sharing

- Download destination.
- Incoming file approval.
- Concurrent transfer limits.
- Bandwidth limits.

### Sync

- Default ignore patterns.
- Conflict policy.
- Synchronization limits.

### Privacy

- Device visibility.
- Clipboard permissions.
- Activity retention.
- Diagnostic export.
- Local data management.

### About

- Application version.
- Daemon version.
- Protocol version.
- License information.
- Open-source acknowledgements.

Do not require an account or remote connection to change settings.

---

## 47. ONBOARDING

First launch must be simple.

### Step 1 — Welcome

Display:

- Lanvory identity.
- Your devices, connected locally.
- No cloud.
- No accounts.
- LAN only.

### Step 2 — Device Setup

- Device name.
- Auto-generated device identity.
- Local network permission explanation.

### Step 3 — Discover

- Enable discovery.
- Show local network.
- Discover nearby peers.

### Step 4 — Pair

- Select peer.
- Verify pairing.
- Configure initial permissions.

Users can complete onboarding even when no other device is online.

Do not create a mandatory signup flow.

Do not use social login.

### Empty State

When no peer is found yet:

- Explain that devices must be running Lanvory.
- Check that they are on the same LAN.
- Check the firewall.
- Provide a refresh action.
- Provide manual pairing.
- Do not require Internet.

---

## 48. SYSTEM TRAY & MENU BAR

Lanvory must support macOS Menu Bar and Windows System Tray.

### Menu Items

```text
Lanvory
LAN Active
Local IP

Nearby Devices
Trusted Devices
Active Transfers

Send Files...
Pause Sync
Manage Services
Open Lanvory
Settings
Quit
```

The tray icon must reflect actual status.

### Lifecycle

Distinguish between:

- Close window.
- Quit GUI.
- Stop daemon.
- Disable discovery.
- Pause synchronization.

Do not silently continue file transfers or network listening after the user chooses to stop the daemon.

Provide clear lifecycle settings.

---

## 49. COMMAND PALETTE & KEYBOARD SHORTCUTS

Build keyboard-first interaction.

### Command Palette

Suggested shortcut:

`Cmd/Ctrl + K`

Commands:

- Find device.
- Pair device.
- Send files.
- Open services.
- Network diagnostics.
- Open settings.
- Refresh discovery.
- Copy local IP.
- Pause sync.

### Requirements

- Fuzzy search.
- Keyboard navigation.
- Accessible focus.
- Recently used commands.
- Context-specific actions.

Do not use global shortcuts that conflict with the OS unless explicitly permitted by the user.

---

## 50. SECURITY THREAT MODEL

Create `docs/security/threat-model.md`.

Assume the LAN is a hostile environment.

Do not treat a private IP address as a security guarantee.

### Threats

- Malicious LAN peer.
- Spoofed mDNS announcement.
- Device impersonation.
- MITM pairing.
- Replay attack.
- Credential theft.
- Compromised trusted peer.
- Malicious file.
- Path traversal.
- Symlink attack.
- Unauthorized service forwarding.
- Local privilege escalation.
- Malicious IPC client.
- Renderer compromise.
- Denial-of-service.
- Resource exhaustion.
- Discovery flooding.
- Protocol downgrade.
- Certificate impersonation.
- Supply-chain attack.

### Security Controls

- Authenticated encryption.
- Device identity verification.
- Secure pairing.
- Public key pinning.
- Per-resource access control.
- Network scope validation.
- Input validation.
- Rate limiting.
- Connection limits.
- Stream limits.
- Strict filesystem boundaries.
- Secret redaction.
- Secure local storage.
- Explicit user consent.
- Dependency scanning.
- Secure release pipeline.

Every sensitive feature must have security acceptance criteria.

Do not silently lower security to make a demo work.

---

## 51. PRIVACY REQUIREMENTS

Create `PRIVACY.md`.

### Rules

- No telemetry by default.
- No external analytics.
- No tracking.
- No advertising SDK.
- No cloud data synchronization.
- No device fingerprint collection by third parties.
- No remote logging.
- No mandatory update checks.
- No remote font loading.
- No remote UI assets.

All assets required for runtime must be bundled locally.

The user must have the right to:

- Disable discovery.
- Change device visibility.
- Review permissions.
- Revoke trust.
- Delete transfer history.
- Delete activity history.
- Reset local application data.

Explain what data remains on the receiving peer after a file transfer or sync completes.

Do not claim the application is completely anonymous merely because there are no accounts.

mDNS metadata can be visible to other devices on the LAN.

---

## 52. CROSS-PLATFORM SUPPORT

### macOS

- Apple Silicon.
- Native Intel coverage follows the compatibility matrix.
- Native Menu Bar.
- Keychain.
- Local Network permission handling.
- Filesystem permission handling.
- DMG packaging.
- Code signing.
- Notarization.

### Windows

- Windows versions listed in the compatibility matrix.
- System Tray.
- Named Pipes.
- Secure storage.
- Firewall permission handling.
- Installer.
- Code signing.
- Native window controls.

### Linux

- Common desktop distributions.
- Unix sockets.
- Secret Service.
- Desktop notifications.
- Tray integration when supported.
- AppImage or equivalent.
- DEB package theo roadmap.

### Requirements

- Platform-specific adapters.
- No hardcoded filesystem paths.
- Cross-platform filename handling.
- Graceful unsupported-feature behavior.
- Explicit capability detection.
- No fake platform support.

### Compatibility matrix

The MVP platform scope is macOS on Apple Silicon. The OS versions below are acceptance targets. Record the exact OS build, CPU, session, artifact hash and evidence level for each run. A major-version row covers the baseline patch build recorded for that milestone. Additional builds require their own evidence before support claims expand.

| Milestone | OS version | CPU | Desktop session | Target support and acceptance | Recorded coverage |
| --- | --- | --- | --- | --- | --- |
| `MVP` | macOS 15 | arm64 | Native macOS login session | Primary desktop. Run §63, native lifecycle and Keychain checks, and the arm64 DMG smoke. Run the signed release gate for public distribution. | Single-host arm64 evidence exists. The macOS 15 physical and release gates are open. |
| `MVP` | macOS 26 | arm64 | Native macOS login session | Additional desktop baseline. Repeat the primary gates on this OS before claiming support. | Current workspace reports macOS 26.6.2. Verify run provenance separately. |
| `POST_MVP` | macOS 15 | x86_64 | Native Intel macOS login session | Desktop. Repeat §63 and validate the x64 DMG on Intel hardware. | Rosetta package smoke exists. Native Intel acceptance is open. |
| `POST_MVP` | Ubuntu 24.04 LTS | x86_64 | GNOME on Wayland | Desktop. Run §63 with an MVP macOS peer, test Secret Service, tray capability detection and package install/startup. | Native Linux desktop acceptance is open. |
| `FUTURE` | Windows 11 25H2 | x86_64 | Windows Explorer desktop | Desktop. Run §63 with a supported peer, test Credential Manager, Named Pipe owner isolation, firewall prompts and signed installer. | Target only. |
| `FUTURE` | Other OS versions, CPU architectures and desktop sessions | — | — | Candidate coverage requires a separate matrix row and acceptance run. | Open. |

Existing Linux core CI provides regression coverage outside MVP acceptance. Native Intel macOS, Linux desktop and Windows desktop follow their later milestones.

For desktop rows, apply the packaging and secure storage checks for that platform. A support claim requires native acceptance for the row. CI, containers and Rosetta supply evidence for their recorded environments. The public macOS release gate requires Developer ID signing, notarization and mounted startup of the release artifact.

---

## 53. PERFORMANCE REQUIREMENTS

Lanvory must be a lightweight desktop utility within Electron's capabilities.

### Optimize

- Application startup.
- Daemon startup.
- Idle CPU.
- Idle memory.
- Discovery performance.
- Connection setup.
- File streaming.
- Transfer throughput.
- Database queries.
- Directory scanning.
- Filesystem watcher usage.
- IPC event volume.
- React rendering.
- Large lists.
- Resource cleanup.

### Requirements

- No unbounded queues.
- No uncontrolled goroutines.
- No memory leaks.
- No excessive polling.
- No full-file buffering.
- No unnecessary background activity.
- Bounded concurrency.
- Backpressure.
- Context cancellation.

Prefer event-driven updates over continuous polling.

Do not perform blocking file hashing in the Electron renderer.

### MVP acceptance measurements

Use two physical hosts from the target matrix, an approved wired LAN at 1 Gb/s full duplex, WAN disconnected, single transfer at a time, and local SSDs. Use a 1 GiB incompressible test file. Record OS builds, hardware, app/daemon build, interface, negotiated link rate, actual transport and raw measurements. A wired result covers the wired baseline. Record Wi-Fi results separately when available.

| Metric | Measurement | Initial MVP target |
| --- | --- | --- |
| First-run configuration | Count steps on a clean profile from first launch to LAN discovery availability. Count the LAN enable action separately from OS permission prompts and required adapter choice. | One in-app LAN enable action, plus any required adapter choice and OS permission prompt. Zero account, WAN or router configuration steps. |
| Discovery latency | Time from starting an explicit discovery refresh with both listeners active to the other device appearing. Repeat 10 times per direction on a LAN that permits mDNS. | At least 9 of 10 runs within 3 s and all within 5 s per direction. |
| Reconnect | Disconnect the approved link for 10 s. After the OS reports the link and approved IP usable, time until the first successful authenticated operation, using one retry per second. Repeat 10 times. | 10 of 10 within 10 s with retained trust, no re-pairing and no manual listener restart. |
| Drop throughput | Measure verified bytes divided by elapsed time from recipient approval to integrity-verified completion. Run three times for QUIC and three for TCP/TLS fallback using the [QUIC and fallback procedure](docs/development/lan-validation.md#quic-transport-check). | Median of at least 40 MiB/s for each transport. All files must match the source digest. |
| Idle memory | With the window open and both peers enabled but idle, sample daemon RSS and total RSS of the Electron process tree separately every 5 s for 5 min after 60 s warm-up. | Peak daemon RSS at most 64 MiB and peak summed Electron RSS at most 400 MiB. Record that summed RSS counts shared pages in each process. |
| Daemon recovery | Terminate the app-owned daemon unexpectedly. Time from termination until the desktop reports readiness and authenticated identity IPC succeeds. Repeat 10 times with secure storage already unlocked. | 10 of 10 within 10 s with stable identity and one daemon instance. Record storage prompts as a separate cold-start case. |

Configuration, idle memory and daemon recovery can be checked on one native target host. Measure discovery, reconnect and Drop throughput on the physical LAN. Retain failed attempts and link the raw measurements in the handoff or performance report before claiming a pass.

---

## 54. LOGGING & OBSERVABILITY

### Logging

- Structured local logging.
- Debug.
- Info.
- Warn.
- Error.
- Log rotation.
- Configurable retention.
- Redaction.

### Metrics

- Discovered peers.
- Trusted peers.
- Active sessions.
- Active streams.
- Bytes sent.
- Bytes received.
- Transfer duration.
- Transfer speed.
- Connection failures.
- Reconnection attempts.
- Sync failures.
- Disk usage.
- Daemon memory usage.

Do not use remote Prometheus or external monitoring infrastructure as a runtime dependency.

Diagnostics and metrics must be collected locally.

Export only when requested by the user.

---

## 55. OFFLINE BEHAVIOR

Lanvory must work when Internet is unavailable.

### Supported Scenarios

- Devices connected to same Wi-Fi.
- Devices connected through Ethernet.
- Wi-Fi and Ethernet on same reachable LAN.
- Router without Internet.
- Local hotspot with peer communication.
- Local DNS unavailable.
- Temporary peer disconnection.

### Offline Peer

Khi peer offline:

- Preserve trust relationship.
- Mark presence offline.
- Queue explicitly approved sync or transfer operations when appropriate.
- Retry with bounded backoff.
- Resume khi peer online.
- Allow cancellation.

Do not send data to third-party services for temporary storage.

If the receiving device is offline, the sender must keep the data or transfer state locally.

---

## 56. TESTING STRATEGY

### Unit Tests

Cover:

- Device identity.
- Fingerprint generation.
- Pairing state machine.
- Trust management.
- Permission evaluation.
- Configuration parsing.
- Protocol validation.
- Network scope validation.
- File path validation.
- Transfer manifest.
- Chunk verification.
- Sync version tracking.
- Conflict detection.
- Service authorization.
- IPC validation.

### Integration Tests

Cover:

- Two independent local daemons.
- Device discovery.
- Secure pairing.
- Peer authentication.
- Trust persistence.
- QUIC connection.
- TCP/TLS fallback.
- File transfer.
- Transfer interruption.
- Transfer cancellation.
- Permission revocation.
- Folder synchronization.
- Service tunnel.
- Database migrations.
- Daemon IPC.

### End-to-End Tests

Cover:

1. Install and launch.
2. Create local identity.
3. Discover another peer.
4. Pair both devices.
5. Confirm public key.
6. Send file.
7. Verify file checksum.
8. Share service.
9. Open local tunnel.
10. Access remote approved service.
11. Revoke peer access.
12. Verify access is blocked.

### Real Network Tests

Test:

- Two physical devices on same Wi-Fi.
- Two devices through Ethernet.
- Wi-Fi to Ethernet.
- Router without Internet.
- DHCP IP change.
- Sleep/wake.
- Network reconnect.
- mDNS unavailable with direct connectivity.
- UDP blocked with TCP fallback.
- Client isolation.
- Multiple network interfaces.
- Firewall restrictions.
- Unauthorized peer.
- Pairing MITM simulation in an isolated test environment.

Do not claim LAN discovery is verified based solely on loopback tests.

### Security Tests

- Untrusted peer rejection.
- Spoofed identity rejection.
- Unapproved service request rejection.
- Malicious path rejection.
- Symlink escape prevention.
- Replay attack handling.
- Invalid protocol message.
- Oversized payload.
- Resource exhaustion controls.
- IPC authorization.
- Secret leakage detection.
- Permission revocation.

### Performance Tests

- Small files.
- Large files.
- Thousands of files.
- Concurrent transfers.
- Large directory scans.
- Long-running daemon.
- Idle memory.
- Interrupted synchronization.

Record environment, hardware, version, and actual results.

---

## 57. UI TESTING

### Renderer Tests

- React component tests.
- Form validation.
- Loading states.
- Empty states.
- Error states.
- Keyboard interactions.
- Theme switching.
- Navigation.
- Permission dialogs.

### Desktop E2E

- Application launch.
- Daemon initialization.
- Window lifecycle.
- Native dialogs if the test environment supports them.
- Pairing interaction.
- File transfer progress.
- Settings persistence.
- Daemon disconnect.
- Reconnection.
- Error recovery.

### Visual Review

Inspect real screenshots of the application.

Compare against DESIGN_SYSTEM.md.

Review:

- Typography.
- Spacing.
- Alignment.
- Contrast.
- Native desktop feel.
- Information density.
- Color consistency.
- Functional hierarchy.

Do not judge UI quality solely from source code.

Development previews using mock data must be clearly marked and must not exist in production flows.

---

## 58. CI/CD

Use GitHub Actions.

### Continuous Integration

- Go test.
- Go race detector.
- Go vet.
- Go lint.
- govulncheck.
- TypeScript type checking.
- ESLint.
- Prettier verification.
- Frontend tests.
- Integration tests.
- Desktop build.
- Gitleaks.
- Dependency security scanning.
- License checks.

### Release Pipeline

- Semantic versioning.
- Changelog.
- Platform binaries.
- Bundled Go daemon.
- Electron packaging.
- macOS DMG.
- Windows installer.
- Linux artifacts.
- Checksums.
- Software Bill of Materials.
- Code signing when credentials are available.
- Notarization when configured.

GitHub Actions is only for build/test/release.

Do not turn CI/CD infrastructure into a runtime dependency.

Do not publish releases or push source code without authorization.

---

## 59. APPLICATION PACKAGING

The application must be installable normally on the user's machine.

Do not require the user to separately install:

- Go runtime.
- Node.js runtime.
- pnpm.
- SQLite server.
- Docker.
- Development toolchain.

The Go daemon must be bundled for the matching platform and architecture.

### Packaging Requirements

- Appropriate binary integrity verification.
- Correct executable permissions.
- Daemon path resolution.
- Installed app path handling.
- First launch initialization.
- Local application data directory.
- Upgrade migration.
- Uninstall behavior.
- Identity persistence policy.
- Secure data reset.

Distinguish between:

- Uninstall application.
- Remove application data.
- Reset device identity.

Do not automatically delete user data on uninstall without an explicit policy and confirmation.

### Update Requirements

The application does not depend on an auto-update server.

Support manual installation of new releases.

If update checking is added in the future, it must be opt-in, transparent, and not affect offline functionality.

---

## 60. DOCUMENTATION

Write complete documentation.

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── peer-architecture.md
│   ├── desktop-architecture.md
│   ├── network-daemon.md
│   └── data-flow.md
│
├── protocols/
│   ├── discovery.md
│   ├── pairing.md
│   ├── peer-authentication.md
│   ├── transport.md
│   ├── file-transfer.md
│   ├── folder-sync.md
│   ├── service-tunnel.md
│   └── ipc.md
│
├── security/
│   ├── threat-model.md
│   ├── identity.md
│   ├── trust-model.md
│   ├── permissions.md
│   └── privacy.md
│
├── design-system/
│   ├── typography.md
│   ├── colors.md
│   ├── layout.md
│   └── components.md
│
├── development/
│   ├── getting-started.md
│   ├── development-setup.md
│   ├── testing.md
│   └── debugging.md
│
├── user-guide/
│   ├── installation.md
│   ├── pairing.md
│   ├── file-sharing.md
│   ├── folder-sync.md
│   ├── service-sharing.md
│   └── troubleshooting.md
│
└── decisions/
    ├── ADR-001-local-only.md
    ├── ADR-002-peer-architecture.md
    ├── ADR-003-transport.md
    ├── ADR-004-device-identity.md
    └── ADR-005-local-storage.md
```

Use Mermaid for architecture diagrams, sequence diagrams, and state machines.

Documentation must reflect the actual implementation.

---

## 61. IMPLEMENTATION ROADMAP

Do not implement all features at once.

Use vertical slices.

Each phase must produce working functionality with clear acceptance criteria.

### Phase 0 — Research & Architecture [`MVP`]

- Inspect repository.
- Research references.
- Verify dependency licenses.
- Define architecture.
- Define trust model.
- Define protocol.
- Define threat model.
- Define design system.
- Create project documentation.
- Create task management.

Exit criteria:

Architecture, security boundaries, and development strategy are fully documented.

### Phase 1 — Application Foundation [`MVP`]

- Monorepo.
- Electron.
- React.
- Go daemon.
- Local IPC.
- SQLite.
- Local configuration.
- Device identity.
- CLI.
- Build scripts.

Exit criteria:

Desktop app runs, communicates with the real daemon, and displays local device identity.

### Phase 2 — Local Discovery [`MVP`]

- mDNS.
- DNS-SD.
- Peer registry.
- Network interface monitoring.
- Device presence.
- Manual discovery.
- Devices screen.

Exit criteria:

Two devices running Lanvory can discover each other on the LAN without Internet.

### Phase 3 — Secure Pairing & Transport [`MVP`]

- Secure pairing.
- Public key verification.
- Trusted peers.
- QUIC transport.
- TCP/TLS fallback.
- Peer authentication.
- Permission engine.
- Revocation.

Exit criteria:

Two devices establish an authenticated encrypted connection and reject unpermitted peers for privileged operations.

### Phase 4 — File Transfer [`MVP`]

- File transfer protocol.
- Incoming approval.
- File streaming.
- Integrity verification.
- Transfer progress.
- Cancel.
- Transfer history.
- Sharing screen.

Exit criteria:

Two devices can transfer real files and verify integrity.

### Phase 5 — Service Sharing [`MVP`]

- Service registry.
- Local proxy.
- TCP stream forwarding.
- Permission enforcement.
- Services screen.
- Tunnel management.

Exit criteria:

Machine B can access a service bound on Machine A's localhost through an authenticated LAN tunnel.

### Phase 6 — Desktop Experience [`MVP` baseline]

- Final shell layout.
- Design system.
- Overview.
- Devices inspector.
- Tray.
- Native menus.
- Command palette (`POST_MVP`).
- Notifications.
- Settings.
- Activity.
- Accessibility.

Exit criteria:

The application delivers a complete desktop experience, not a website or dashboard prototype.

### Phase 7 — Folder Synchronization [`POST_MVP`]

- Filesystem monitoring.
- Sync manifest.
- Version tracking.
- Incremental sync.
- Conflict management.
- Deletion protection.
- Sync screen.

Exit criteria:

Two devices synchronize folders two-way without silently overwriting concurrent changes.

### Phase 8 — Device Collaboration [`POST_MVP` baseline, `FUTURE` messaging]

- Shared clipboard.
- Local messaging (`FUTURE`).
- Device collaboration permissions.
- Notification preferences.

### Phase 9 — Developer Tools [`MVP` diagnostics, `POST_MVP` explorer, `FUTURE` SDK]

- Network explorer (`POST_MVP`).
- Basic network diagnostics (`MVP`).
- Developer SDK (`FUTURE`).

### Phase 10 — Automation & Backup [`FUTURE`]

- Local automation engine.
- Backup jobs.
- Snapshot/version retention.
- Restore.
- Automation permissions.

### Phase 11 — Production Hardening [`MVP` baseline, `POST_MVP` and `FUTURE` expansion]

- Security review.
- Fuzz testing.
- Performance benchmarks.
- Long-running tests.
- Cross-platform validation.
- Packaging.
- CI/CD.
- Documentation.
- Release readiness.

Do not mark a phase as complete if exit criteria have not been verified.

---

## 62. MVP DEFINITION

Lanvory MVP ships only for macOS on Apple Silicon, with OS baselines defined in §52. Continue using the Go network daemon and Electron desktop application with authenticated local IPC. This platform scope applies to implementation, packaging and product acceptance.

The MVP includes:

- Electron desktop app.
- Go network daemon.
- Secure local IPC.
- Device identity.
- mDNS discovery.
- Manual discovery fallback.
- Secure device pairing.
- Trusted device management.
- Authenticated encrypted transport.
- TCP/TLS fallback.
- Per-peer permissions.
- File transfer.
- Incoming file approval.
- Basic service sharing.
- Local TCP tunnel.
- Network diagnostics.
- System Tray.
- Local settings.
- Activity history.
- CLI.
- macOS package.
- Automated tests.
- Security documentation.

### Requirement groups

| Scope | Requirement groups |
| --- | --- |
| `MVP` | Offline LAN-only operation, architecture and security invariants, identity, local storage and IPC, discovery with manual fallback, pairing, transport, permissions, Devices, approved single-file Drop, basic Bridge and loopback tunnel, local diagnostics and CLI, core desktop screens and settings, tray, onboarding, accessibility, tests, documentation and macOS arm64 packaging. |
| `POST_MVP` | Folder Sync, shared clipboard and associated permissions and preferences, Network Explorer, command palette and expanded shortcuts, advanced Drop features (batching, directories and resume), native Intel macOS and Linux desktop. |
| `FUTURE` | Local Messaging, Developer SDK, Local Automation, Local Backup and Windows desktop. |

Apply security, privacy, testing, performance and documentation requirements to every group as it ships. Optional or capability-dependent details retain their existing conditions. The phase numbers express delivery order within authorized scope. MVP packaging includes local artifact checks. Public distribution additionally requires the release gate in §52.

---

## 63. MVP ACCEPTANCE CRITERIA

MVP is only considered verified when:

1. Two independent devices run Lanvory.
2. No account is required.
3. No central server is required.
4. No Cloud service is required.
5. The router can have Internet disconnected.
6. Both devices discover each other when the LAN permits mDNS.
7. Both devices pair successfully.
8. Public keys are verified.
9. Pairing persists across restarts.
10. An encrypted authenticated connection is established.
11. Untrusted peers are denied resource access.
12. Real file transfer succeeds.
13. File checksums match.
14. Incoming transfers require approval by default.
15. Shared localhost services work.
16. Local tunnels are scoped to the exact resource.
17. Revoked peers lose access.
18. Network disconnects are handled.
19. Reconnection works when peers return.
20. UI reflects real data.
21. Daemon follows the proper lifecycle.
22. Local settings are persisted.
23. Secrets never appear in logs.
24. Build succeeds.
25. Automated tests pass.
26. Known limitations are documented.
27. MVP acceptance measurements in §53 meet their targets on the applicable baseline.
28. The MVP desktop rows in §52 have the required native and physical evidence. For a public release, apply the separate signing and notarization gate.

Record physical evidence for criteria 1–19 through the two-device run. Local source, test, build and desktop evidence may cover criteria 20–26 where applicable. Record each measurement and matrix row separately.

Do not treat pretty screenshots or mock data as proof of MVP completion.

---

## 64. CODING STANDARDS

### General

- KISS.
- YAGNI.
- DRY.
- Separation of concerns.
- Explicit dependencies.
- Secure by default.
- Predictable behavior.
- Maintainable code.
- Testable code.

### Go

- Context propagation.
- Explicit error handling.
- Error wrapping.
- Small interfaces.
- Bounded concurrency.
- Goroutine cleanup.
- Race-free shared state.
- Proper resource cleanup.
- Structured logging.
- Standard library first.

### TypeScript

- Strict mode.
- Typed IPC contracts.
- No unnecessary `any`.
- Schema validation at trust boundaries.
- Small reusable components.
- Feature-based organization.
- Clear state ownership.
- No duplicated backend business logic.
- Proper effect cleanup.

### CSS

- Semantic design tokens.
- Consistent spacing.
- Consistent typography.
- Accessible colors.
- Reusable component styles.
- Minimal overrides.
- No arbitrary colors scattered throughout components.

### Forbidden Practices

- Fake implementation.
- Hardcoded production data.
- Random metrics.
- Empty business methods.
- Silent error handling.
- Unbounded retries.
- Security bypass.
- Ignoring failed tests.
- Disabling type checking.
- Suppressing compiler errors without resolving root cause.
- Large generated code with no clear purpose.

Use English for source code, technical naming, and documentation.

Report progress to the user in Vietnamese.

---

## 65. AGENT EXECUTION PROTOCOL

When starting, work directly on the repository.

### Step 1 — Inspect

- Check working directory.
- Check Git status.
- Read AGENTS.md.
- Read PROJECT_SPEC.md.
- Read existing documentation.
- Inspect existing source code.
- Inspect dependencies.
- Check available toolchains.
- Check platform.
- Check available permissions.

Do not overwrite existing user changes.

### Step 2 — Research

Study critical technical requirements before choosing an implementation.

Record:

- Source.
- Requirement.
- Decision.
- Tradeoff.
- Security implications.
- License implications.

### Step 3 — Plan

Create ROADMAP.md and TASKS.md.

Each task must have:

- Task ID.
- Scope (`MVP`, `POST_MVP`, or `FUTURE`).
- Required and recorded evidence levels.
- Description.
- Dependencies.
- Status.
- Acceptance criteria.
- Verification commands.
- Security considerations.

Task statuses:

```text
TODO
IN_PROGRESS
BLOCKED
UNVERIFIED
IN_REVIEW
DONE
```

### Step 4 — Implement

- Pick a task whose dependencies are satisfied.
- Create the real implementation.
- Write tests.
- Update documentation.
- Verify integration.
- Review security.

### Step 5 — Verify

Execute:

- Formatter.
- Lint.
- Type checking.
- Unit tests.
- Integration tests.
- Build.
- Relevant security checks.

Do not claim a command passed without running it.

### Step 6 — Fix

If a test fails:

- Identify the root cause.
- Fix the bug at the proper layer.
- Add a regression test.
- Re-run verification.

Do not modify tests to ignore broken behavior.

### Step 7 — Continue

After completing a task:

- Update TASKS.md.
- Update ROADMAP.md.
- Update HANDOFF.md.
- Record architecture decisions.
- Continue next task.

Do not stop after creating a scaffold.

Continue independent tasks within the authorized scope when a task needs unavailable hardware, an OS, hosted CI access or signing credentials. In TASKS.md and HANDOFF.md, record the affected criteria, available evidence, missing evidence, exact prerequisites and reproduction steps. Use `UNVERIFIED` when implementation is ready and only verification is outstanding, or `BLOCKED` when the missing prerequisite prevents implementation. Keep `IN_PROGRESS` while feasible work remains on the same task. A blocked verification dependency stays open for dependent acceptance claims.

Stop when the requested scope is satisfied or every remaining in-scope task requires a blocker to be resolved. Existing authorization requirements still apply to hardware access, credentials, spending, destructive operations, release publication and changes to firewall, router or system security settings.

---

## 66. PERSISTENT PROJECT MEMORY

Create:

```text
AGENTS.md
PROJECT_SPEC.md
DESIGN_SYSTEM.md
ROADMAP.md
TASKS.md
HANDOFF.md
docs/decisions/
```

### HANDOFF.md

Must record:

- Current phase.
- Current implementation.
- Completed tasks.
- Unfinished tasks.
- Latest verification results.
- Security decisions.
- Architecture decisions.
- Known issues.
- Blockers.
- Next task.
- Commands to reproduce.
- Files modified.

### New Agent Session

When a new agent session begins:

1. Read instructions.
2. Check Git status.
3. Read project documents.
4. Inspect actual source code.
5. Verify task status.
6. Continue unfinished tasks.
7. Do not re-initialize the project.
8. Do not arbitrarily change architecture.

Source code, build output, and test results are more accurate evidence than progress notes.

---

## 67. DEFINITION OF DONE

Evidence is tracked per criterion, platform and artifact, independently of task status.

| Evidence level | Required record |
| --- | --- |
| `IMPLEMENTED` | Source paths and the implemented behavior. |
| `LOCALLY_VERIFIED` | Commands or manual steps, environment and results from local automated tests, containers, emulation, single-host native checks or ad hoc package smoke. Record hosted CI separately with its run result and environment when required. |
| `PHYSICALLY_VERIFIED` | Native hardware, OS and architecture, build identifier, and results from the applicable hardware procedure. LAN criteria require two independent physical devices with WAN disconnected. |
| `RELEASE_VERIFIED` | Release artifact identifier and checksum, authorized signing and platform trust checks, inventory and packaged smoke results. For macOS, include successful Developer ID verification and a validated stapled notarization ticket. |

Set the evidence required for each acceptance criterion before implementation. Record the date, environment, commands or procedure, actual result and artifact/log reference where available. Each level covers the checks and environment recorded for it. Artifact checks and physical LAN checks require their own evidence.

Mark a task `DONE` when the scoped implementation, error handling, permissions, tests, security review and documentation are complete and every applicable acceptance criterion has its required evidence. Build, lint and type checks must pass where applicable. Record known limitations. Locally scoped subtasks may be `DONE` after local verification while physical or release gates remain open as separate tasks. Apply §65 when evidence is missing.

---

## 68. FINAL DELIVERABLES

Deliver these outputs at their milestone under §62. Cross-platform packaging and compatibility reports cover the rows accepted for each milestone. Release configuration follows the applicable public distribution gate.

1. Lanvory Desktop Application.
2. Lanvory Network Daemon.
3. Lanvory CLI.
4. Secure Device Identity.
5. Peer Discovery Engine.
6. Secure Pairing Engine.
7. Trusted Device Management.
8. Secure Peer Transport.
9. Permission Engine.
10. File Transfer Engine.
11. Folder Sync Engine.
12. Shared Clipboard.
13. Local Service Sharing.
14. Local Tunnel.
15. Network Explorer.
16. Network Diagnostics.
17. Local Messaging.
18. Local Automation.
19. Local Backup.
20. Local SQLite Database.
21. Local IPC Protocol.
22. Design System.
23. Application Branding.
24. Cross-platform Packaging.
25. Automated Test Suite.
26. Security Threat Model.
27. Architecture Documentation.
28. Developer Guide.
30. User Guide.
31. Privacy Documentation.
32. CI/CD Pipelines.
33. Performance Report.
34. Platform Compatibility Report.
35. Known Limitations Report.
36. Release Configuration.

Do not require any central server or cloud infrastructure to run the product.

---

## 69. FINAL EXECUTION INSTRUCTION

Continue work in the current repository within the user's authorized scope. For an unqualified request to implement or finish Lanvory, default to `MVP`. Start `POST_MVP` or `FUTURE` implementation only when requested.

Do not reply only with explanations, plans, or code snippets.

Execute in order:

1. Inspect repository.
2. Research reference projects.
3. Verify technical dependencies.
4. Verify licenses.
5. Design system architecture.
6. Define security threat model.
7. Define device trust model.
8. Create development documentation.
9. Create design system.
10. Initialize monorepo.
11. Implement network daemon.
12. Implement secure local IPC.
13. Implement device identity.
14. Implement mDNS discovery.
15. Implement pairing.
16. Implement authenticated transport.
17. Implement permission engine.
18. Verify real peer connection.
19. Implement file transfer.
20. Implement service sharing.
21. Implement local tunnel.
22. Implement desktop application.
23. Implement native OS integration.
24. Implement CLI.
25. Complete MVP validation.
26. Complete the automated tests, security hardening, packaging and documentation for the current milestone throughout delivery.
27. Apply §65 when a verification prerequisite is unavailable.
28. For explicitly requested later milestones, follow §62 and extend platform coverage using §52.

After each phase, report in Vietnamese:

- Completed.
- Modified files.
- Architecture decisions.
- Commands executed.
- Actual test results.
- Security considerations.
- Known limitations.
- Blockers.
- Next tasks.

Prioritize:

Security > Correctness > Reliability > Functionality > User Experience > Maintainability > Performance.

Do not sacrifice security or correctness to speed up progress.

Lanvory must be a real local-network desktop networking application, not a prototype, not a cloud service, not a VPN clone, and not a generic AI-generated dashboard.

Final product philosophy:

Your devices.
Your network.
Your rules.

No cloud.
No accounts.
No central servers.

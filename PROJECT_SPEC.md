# LANVORY — MASTER PROJECT DEVELOPMENT SPECIFICATION


## 01. ROLE

Bạn hãy đóng vai một đội ngũ phát triển phần mềm cao cấp bao gồm:

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

Bạn có trách nhiệm nghiên cứu, thiết kế, triển khai, kiểm thử, tối ưu, bảo mật và hoàn thiện toàn bộ dự án Lanvory.

Bạn là Autonomous Coding Agent, không chỉ là trợ lý tư vấn.

Phải trực tiếp:

- Phân tích repository.
- Tạo và chỉnh sửa source code.
- Cài đặt dependency cần thiết.
- Thực thi terminal commands.
- Thiết kế kiến trúc.
- Triển khai functionality.
- Xây dựng giao diện.
- Viết automated tests.
- Chạy tests và build.
- Phân tích và sửa lỗi.
- Kiểm tra security.
- Viết documentation.
- Hoàn thiện quy trình release.

Không dừng lại ở architecture proposal, pseudocode, project scaffolding hoặc UI prototype.

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

Lanvory không phải VPN, không phải Cloud Storage, không phải Tailscale clone và không phải ứng dụng quản lý mạng thông qua server trung tâm.

Lanvory là một nền tảng kết nối và chia sẻ tài nguyên giữa những thiết bị trong cùng mạng nội bộ.

---

## 03. NON-NEGOTIABLE REQUIREMENTS

Đây là những ràng buộc kiến trúc bắt buộc.

### No Cloud

Không sử dụng:

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

Không được bổ sung Cloud dependency để đơn giản hóa implementation.

### No Central Server

Không xây dựng:

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

Mỗi thiết bị là một peer độc lập và có network listener để giao tiếp với các peer khác.

Không được yêu cầu một thiết bị cố định luôn online để quản lý những thiết bị còn lại.

### No Account

Không triển khai:

- Sign up.
- Sign in.
- Email authentication.
- OAuth.
- Auth0.
- Social login.
- Password reset.
- User account management.

Danh tính được tạo và quản lý trực tiếp trên từng thiết bị.

### LAN Only

Chỉ hỗ trợ kết nối thông qua local network interface và những endpoint thuộc mạng nội bộ được phép.

Không triển khai:

- Internet P2P.
- NAT Traversal.
- UDP Hole Punching xuyên Internet.
- Public Relay.
- Public Tunnel.
- Public Port Forwarding.
- Remote Cloud Access.
- VPN Virtual IP.
- Exit Node.
- WireGuard Tunnel.

Phải có network scope validation và không chỉ dựa vào việc địa chỉ IP thuộc private IP range để kết luận endpoint an toàn.

Không tự động giao tiếp qua VPN interface, public interface hoặc những interface không được người dùng cho phép.

### No Internet Required

Runtime functionality phải hoạt động khi:

- Router không có Internet.
- Ethernet network không có Internet.
- Local Wi-Fi không có Internet.
- Mobile Hotspot cho phép peer communication.

Việc tải dependency, phát triển phần mềm và phát hành bản cập nhật có thể cần Internet, nhưng không được biến Internet thành điều kiện bắt buộc để sử dụng ứng dụng.

### Local Data Ownership

Mọi dữ liệu ứng dụng được lưu tại thiết bị.

- Device identity.
- Private keys.
- Trusted peers.
- Application settings.
- Transfer history.
- Sync configuration.
- Shared services.
- Permissions.
- Activity logs.

Không gửi dữ liệu tới external service.

---

## 04. PRODUCT DIFFERENTIATION

Lanvory có thể tham khảo ý tưởng từ LocalSend, Syncthing, KDE Connect và các Developer Tools, nhưng phải có product identity riêng.

Không xây dựng Lanvory chỉ như một File Transfer App.

Lanvory phải kết hợp:

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

Giá trị khác biệt là cung cấp một desktop workspace thống nhất để quản lý và sử dụng tài nguyên giữa nhiều thiết bị trong cùng LAN.

---

## 05. REFERENCE PROJECTS

Nghiên cứu các repository và tài liệu chính thức:

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

Nghiên cứu thêm RFC liên quan đến:

- mDNS.
- DNS-SD.
- QUIC.
- TLS 1.3.
- Ed25519.
- Secure authentication.

Đánh giá:

- Architecture.
- Protocol design.
- Security model.
- Dependency health.
- Maintenance status.
- License compatibility.
- Cross-platform support.

Không sao chép nguyên trạng source code hoặc UI của các sản phẩm tham khảo.

Kiểm tra license trước khi tái sử dụng implementation.

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
- TanStack Query khi phù hợp.
- Zod.
- Lucide Icons.
- React Hook Form.
- Electron Builder.

Không sử dụng Next.js cho desktop renderer nếu không có technical requirement rõ ràng.

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

Ưu tiên SQLite driver phù hợp với cross-platform packaging và hạn chế native dependency không cần thiết.

### Secure Storage

- macOS Keychain.
- Windows Credential Manager hoặc DPAPI.
- Linux Secret Service hoặc system-protected storage.

### Local IPC

- Unix Domain Socket trên macOS/Linux.
- Named Pipe trên Windows.
- Versioned typed protocol.
- Request/response.
- Event streaming.

### Additional Components

- fsnotify cho filesystem monitoring.
- SHA-256 hoặc BLAKE3 cho file integrity.
- React Flow cho network visualization khi cần.
- QR Code generation và scanning khi phần cứng hỗ trợ.

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

Sử dụng dependency stable, được duy trì và tương thích.

Không thêm framework chỉ vì phổ biến.

---

## 07. SYSTEM ARCHITECTURE

Lanvory sử dụng Fully Decentralized Peer Architecture.

Mỗi thiết bị chạy toàn bộ các thành phần cần thiết để discovery, pairing, truyền dữ liệu và quản lý local permissions.

Không tồn tại coordinator trung tâm.

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

Các đường kết nối biểu diễn khả năng giao tiếp trực tiếp giữa peers, không yêu cầu duy trì kết nối full-mesh liên tục.

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
- Modular monolith tại từng thiết bị.
- Transport abstraction.
- Platform abstraction.
- Event-driven state updates.
- Local-first persistence.
- No centralized coordination.
- No unnecessary microservices.

Không triển khai Kubernetes, Redis, message broker hoặc distributed database.

---

## 08. REPOSITORY STRUCTURE

Sử dụng multi-language monorepo.

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

Đây là cấu trúc mục tiêu.

Chỉ tạo module khi có implementation thực tế. Không tạo hàng loạt empty folders, interfaces hoặc abstraction chưa cần sử dụng.

---

## 09. NETWORK DAEMON

Tên background process:

`lanvoryd`

Daemon chịu trách nhiệm về networking, local storage, identity, security và background services.

### Requirements

- Hoạt động độc lập với renderer.
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

Ưu tiên chạy daemon dưới quyền người dùng thông thường.

Không yêu cầu administrator hoặc root cho functionality không cần quyền đặc biệt.

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

Phải xử lý:

- Electron khởi động trước daemon.
- Daemon khởi động trước Electron.
- Daemon bị crash.
- Duplicate daemon process.
- Application restart.
- IPC disconnect.
- Network change.
- Computer sleep/wake.
- Application shutdown.

Phải ngăn nhiều daemon instance sử dụng chung database hoặc identity không an toàn.

---

## 10. DEVICE IDENTITY

Mỗi thiết bị tự tạo danh tính trong lần khởi động đầu tiên.

Không yêu cầu user account.

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

Sử dụng Ed25519 cho long-term device identity.

Device ID nên được dẫn xuất một cách xác định từ public key theo format đã được version hóa.

Không sử dụng MAC address, IP address hoặc hardware serial number làm security identity.

### Private Keys

- Được tạo tại local.
- Sử dụng cryptographically secure random generator.
- Không được export mặc định.
- Không truyền tới peer.
- Không xuất hiện trong log.
- Không xuất hiện trong renderer.
- Không lưu plaintext trong SQLite.

Identity phải được bảo vệ tại OS secure storage phù hợp.

Nếu secure storage không khả dụng, phải có cơ chế fallback được thiết kế, giải thích và kiểm thử rõ ràng; không âm thầm giảm mức bảo mật.

Device identity phải giữ ổn định khi IP hoặc hostname thay đổi.

Identity reset phải có explicit user confirmation.

---

## 11. LOCAL DEVICE DISCOVERY

Sử dụng mDNS và DNS-SD làm discovery mechanism chính.

Service type:

`_lanvory._udp.local.`

Nếu sử dụng TCP fallback, có thể đăng ký service type tương ứng:

`_lanvory._tcp.local.`

### Announcement Metadata

Ví dụ:

```json
{
  "deviceId": "device-fingerprint",
  "protocolVersion": 1,
  "appVersion": "0.1.0",
  "capabilities": ["pairing", "transfer"]
}
```

Chỉ công bố metadata tối thiểu cần thiết.

Không đưa secret, token, file path, permissions hoặc thông tin nhạy cảm vào mDNS TXT records.

Hostname và device display name phải có privacy settings phù hợp.

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
- IPv6 local connectivity khi phù hợp.
- Multiple interface handling.
- Manual endpoint discovery.
- Discovery retry.
- Refresh discovery.

Discovery không đồng nghĩa với authentication.

Mọi discovered peer đều là untrusted cho đến khi pairing thành công.

### Network Changes

Phải xử lý:

- Wi-Fi switching.
- Ethernet connection.
- DHCP address change.
- Interface removal.
- Sleep and wake-up.
- Multiple network adapters.
- VPN interface presence.
- Network disconnection.

### Discovery Fallback

Nếu mDNS bị chặn nhưng hai thiết bị vẫn có thể kết nối trực tiếp, hỗ trợ manual pairing bằng local IP và port.

Không triển khai aggressive subnet scanning mặc định.

Không bypass client isolation hoặc network security policies.

---

## 12. SECURE DEVICE PAIRING

Không tự động trust thiết bị chỉ vì chúng xuất hiện trong cùng mạng LAN.

### Pairing Methods

- Numeric verification code.
- QR Code.
- Public key fingerprint verification.
- Manual endpoint pairing.

### Pairing Flow

1. Device A phát hiện Device B.
2. User chọn Pair Device.
3. Device A gửi pairing request.
4. Device B hiển thị incoming request.
5. Hai thiết bị thực hiện secure handshake.
6. Hai bên xác minh identity thông qua fingerprint hoặc short authentication string.
7. Người dùng xác nhận thông tin trùng khớp.
8. Hai bên lưu trusted public key.
9. Thiết lập authenticated secure session.
10. Áp dụng default permissions.

Giá trị verification code phải được ràng buộc với cryptographic handshake transcript và danh tính của hai thiết bị.

Không truyền một mã PIN qua kết nối chưa được xác thực rồi coi đây là cơ chế chống MITM.

Nếu triển khai pairing dùng secret có entropy thấp, nghiên cứu PAKE hoặc protocol pairing đã được kiểm chứng.

QR Code có thể chứa public key fingerprint, endpoint và pairing challenge có thời hạn.

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

Khi public key của trusted device thay đổi, không tự động chấp nhận key mới.

Phải yêu cầu người dùng xác minh và pairing lại hoặc sử dụng cơ chế key rotation đã được xác thực.

---

## 13. SECURE P2P TRANSPORT

Sử dụng QUIC làm preferred peer transport.

Implementation:

- quic-go.
- TLS 1.3.
- Mutual device authentication.
- Pinned peer identity.
- ALPN protocol negotiation.
- Multiplexed streams.

Sử dụng TCP với TLS làm fallback nếu UDP không khả dụng.

Fallback chỉ được thực hiện trong local network và phải duy trì cùng security guarantees.

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

Sử dụng TLS certificates được liên kết đúng với device identity và xác minh trust bằng key đã được pairing.

Không sử dụng `InsecureSkipVerify` để bỏ qua authentication trừ khi có custom verification đầy đủ và được security review.

Không tự thiết kế encryption algorithm.

Không sử dụng encryption keys cố định hoặc hardcoded secrets.

Vô hiệu hóa 0-RTT đối với các thao tác có khả năng bị replay nếu chưa có replay protection phù hợp.

### Transport Abstraction

Application modules không phụ thuộc trực tiếp vào QUIC implementation.

Tạo transport abstraction đủ để hỗ trợ:

- QUIC.
- TCP/TLS.
- Test transport.
- Future local transport.

Không bắt buộc duy trì connection với toàn bộ peers cùng lúc.

Có thể sử dụng on-demand connection và idle timeout.

---

## 14. PEER PROTOCOL

Thiết kế versioned application protocol.

### Protocol Envelope

```json
{
  "version": 1,
  "requestId": "unique-request-id",
  "type": "peer.info",
  "payload": {}
}
```

Danh tính người gửi phải được lấy từ authenticated transport session, không tin tưởng `senderId` tùy ý do client gửi trong payload.

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

Sử dụng protocol framing phù hợp cho binary stream.

Không bắt buộc sử dụng JSON cho dữ liệu file hoặc mọi network packet.

Large binary payload phải được stream thay vì encode toàn bộ thành Base64.

Tạo protocol documentation và compatibility tests.

---

## 15. TRUST MODEL & PERMISSIONS

Lanvory sử dụng per-device trust model.

Trusted peers không mặc định được cấp mọi quyền truy cập.

### Trust States

- Discovered.
- Untrusted.
- Pairing.
- Trusted.
- Blocked.
- Revoked.

Online/offline là presence state, không phải trust state.

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

Mỗi thiết bị phải tự enforce quyền truy cập đối với tài nguyên của chính mình.

Không tồn tại global admin role hoặc centralized ACL.

Trust giữa A và B không đồng nghĩa B có thể đại diện A để trust C.

Không tự động propagate trust xuyên thiết bị.

Trusted device bị revoke phải bị ngắt active session liên quan và không được tiếp tục truy cập resource nếu không pairing lại.

---

## 16. LOCAL DATABASE

Sử dụng SQLite.

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

Chỉ tạo bảng khi feature tương ứng thực sự cần.

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

Không lưu:

- Raw private keys.
- Plaintext authentication secrets.
- Sensitive clipboard history mặc định.
- File content không cần thiết.

Không bắt buộc encryption toàn bộ SQLite nếu OS-level protection và threat model không yêu cầu, nhưng sensitive data phải được bảo vệ phù hợp.

---

## 17. DEVICE MANAGEMENT

### Devices Screen

Hiển thị:

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
- Measured latency nếu có.

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

Không hiển thị fake latency hoặc fake online status.

Phân biệt:

- Discovered.
- Reachable.
- Authenticated.
- Connected.
- Offline.

---

## 18. FILE TRANSFER — LANVORY DROP

Xây dựng secure peer-to-peer file transfer.

### Features

- Single-file transfer.
- Multi-file transfer.
- Folder transfer.
- Drag and drop.
- Incoming transfer confirmation.
- Transfer queue.
- Parallel transfers có giới hạn.
- Progress.
- Speed.
- Estimated remaining time.
- Cancel.
- Retry.
- Pause/resume khi protocol hỗ trợ.
- Transfer history.
- Destination selection.
- Open received folder.
- Integrity verification.

### Transfer Flow

1. Sender chọn file.
2. Sender chọn trusted peer.
3. Sender tạo transfer manifest.
4. Receiver nhận transfer offer.
5. Receiver xác nhận hoặc từ chối.
6. Kiểm tra disk availability và permission.
7. Stream file chunks.
8. Kiểm tra integrity.
9. Hoàn tất file tại destination.
10. Ghi nhận kết quả.

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
- Archive-bomb protection nếu hỗ trợ archive.
- Integrity verification.

Không tự động thực thi file đã nhận.

Không tự động ghi file vào arbitrary filesystem location.

Sử dụng temporary file và atomic completion khi filesystem hỗ trợ.

### Resume Protocol

Hỗ trợ resume bằng transfer ID và verified chunk information.

Phải xác minh source file không bị thay đổi trước khi tiếp tục transfer.

Không buộc đọc toàn bộ file vào memory.

Kiểm thử file kích thước lớn, interruption và network reconnect.

---

## 19. FOLDER SYNCHRONIZATION — LANVORY SYNC

Xây dựng decentralized folder synchronization.

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
- Chunk-based synchronization khi phù hợp.
- Rename detection khi khả thi.
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

Không sử dụng modification timestamp như nguồn sự thật duy nhất.

Phải thiết kế version vectors hoặc cơ chế version tracking phù hợp để phát hiện concurrent changes.

Không áp dụng CRDT một cách tùy tiện cho arbitrary binary files.

### Conflict Handling

Ví dụ:

```text
document.md
document.conflict-macbook-20261120.md
```

Không tự động ghi đè thay đổi của người dùng khi có concurrent modifications.

Phải hiển thị conflict rõ ràng và hỗ trợ resolution.

### Deletion Safety

- Explicit deletion policy.
- Tombstones.
- Version history hoặc trash strategy.
- Mass-deletion warning.
- Protection against accidental destructive sync.

Không tự động đồng bộ mọi folder trên máy.

Chỉ đồng bộ folder được user chọn và peer được cấp quyền.

---

## 20. SHARED CLIPBOARD

Cho phép chia sẻ clipboard giữa trusted devices.

### Supported Data

- Plain text.
- URLs.
- Images theo roadmap.
- Files hoặc rich content sau khi có thiết kế security phù hợp.

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

Không tự động broadcast clipboard đến tất cả peers.

Không tự động paste hoặc thực thi clipboard contents từ remote peer.

Phải có cơ chế tránh vòng lặp:

Device A updates B → B updates A → repeated synchronization.

Không tuyên bố có thể phát hiện chính xác mọi password hoặc secret trong clipboard.

Cho phép người dùng giới hạn loại dữ liệu và tắt tính năng khi cần.

---

## 21. LOCAL SERVICE SHARING — LANVORY BRIDGE

Cho phép người dùng chia sẻ local services với trusted devices.

Ví dụ:

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

Machine B truy cập thông qua local endpoint:

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

Không yêu cầu ứng dụng Next.js thay đổi binding sang `0.0.0.0`.

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

Không publish arbitrary ports tự động.

Chỉ những service được người dùng tạo rõ ràng mới được truy cập.

Remote peer không được cung cấp arbitrary destination address để biến Lanvory thành general-purpose proxy.

Không hỗ trợ unrestricted remote network scanning hoặc internal network pivoting.

Service forwarding phải được giới hạn tới resource đã đăng ký.

Không cho phép truy cập Cloud metadata endpoint hoặc địa chỉ ngoài phạm vi đã được xác định.

Local proxy trên receiving device phải bind loopback mặc định.

Không bypass authentication của underlying services.

---

## 22. LOCAL TUNNEL

Xây dựng TCP stream forwarding qua authenticated peer connection.

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

QUIC encryption chỉ bảo vệ đoạn truyền giữa các Lanvory peers.

Phải mô tả rõ trust boundary giữa local application, tunnel endpoints và target service.

Không tuyên bố Lanvory là system-wide VPN.

Không sử dụng TUN/TAP interface nếu không có requirement mới được người dùng phê duyệt.

---

## 24. LOCAL MESSAGING

Xây dựng lightweight local messaging.

### Features

- One-to-one messaging.
- Text messages.
- Message timestamps.
- Delivery status.
- Unread messages.
- Local message history.
- Offline message queue.
- Retry.
- Message deletion tại local.
- Conversation permission.

Message delivery chỉ diễn ra khi hai peer có thể kết nối.

Không triển khai cloud store-and-forward.

Không giả định có thể xóa tin nhắn đã lưu trên thiết bị khác.

Message payload phải đi qua authenticated encrypted transport.

Đây là tính năng roadmap, không được làm chậm networking foundation.

---

## 25. NETWORK EXPLORER

Xây dựng network visualization riêng cho Lanvory.

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

Visualization chỉ phản ánh thông tin thực tế mà local node biết.

Không suy diễn topology vật lý của router hoặc kết nối giữa hai remote peers khi không có dữ liệu.

Không sử dụng fake graph edges.

Network graph phải phục vụ việc hiểu trạng thái kết nối, không chỉ là decorative animation.

---

## 26. NETWORK DIAGNOSTICS

Xây dựng diagnostics tools.

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
- Firewall-related errors nếu xác định được.

### Diagnostic Actions

- Refresh discovery.
- Peer ping.
- Test authenticated connection.
- Test approved service connectivity.
- Inspect local listener.
- Export sanitized diagnostic report.
- Restart networking.
- Reset discovery.

Không fabricate networking metrics.

Không tự động quét toàn bộ LAN.

Không tự động thay đổi firewall configuration.

---

## 27. LOCAL AUTOMATION

Thiết kế rule-based automation engine chạy tại local.

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

Khi MacBook vào mạng LAN tại nhà:

- Phát hiện Mac Mini.
- Kiểm tra trusted identity.
- Khởi động folder synchronization đã được cấu hình.
- Hiển thị progress.
- Thông báo khi hoàn tất.

Không cho phép remote peer gửi arbitrary executable automation.

Không thực thi arbitrary shell scripts mặc định.

Automation phải được user tạo, kiểm tra, enable và revoke tại local.

---

## 28. LOCAL BACKUP

Cho phép backup dữ liệu sang trusted device.

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

Phân biệt Backup và Folder Sync.

Folder Sync có thể đồng bộ deletion.

Backup phải được thiết kế để bảo vệ dữ liệu khỏi accidental deletion hoặc corruption.

Không tuyên bố backup an toàn nếu chưa kiểm thử restore.

---

## 29. CLI APPLICATION

Tên CLI:

`lanvory`

CLI giao tiếp với local daemon qua secure IPC.

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
- Shell completion khi phù hợp.
- Input validation.
- Timeout.
- Secure IPC.
- No plaintext secrets.

Sensitive operation vẫn phải tuân thủ trust model và user consent.

CLI không được bypass permissions của Desktop Application.

---

## 30. LOCAL IPC

Electron Main Process và CLI giao tiếp với Go daemon qua local IPC.

### Requirements

- Unix socket permissions.
- Windows Named Pipe ACL.
- OS-level peer authentication khi khả thi.
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

Không expose privileged IPC server qua public TCP interface.

Không cho phép Electron renderer truy cập raw IPC socket.

IPC permissions phải được kiểm chứng tại daemon.

---

## 31. DESKTOP APPLICATION STRUCTURE

Lanvory phải là desktop application, không phải website được đóng gói trong Electron.

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

Không implement network daemon logic trong React component.

Không cho renderer trực tiếp truy cập filesystem, shell, OS credentials hoặc arbitrary Node.js API.

### Electron Security

- `contextIsolation: true`.
- `nodeIntegration: false`.
- `sandbox: true` khi phù hợp.
- Strict Content Security Policy.
- Sender validation.
- Navigation restrictions.
- External URL validation.
- Restricted window creation.
- No arbitrary shell execution.
- No remote HTML loading.

---

## 32. PRODUCT DESIGN DIRECTION

Thiết kế Lanvory dựa trên phong cách:

**Retro Terminal × Editorial Minimalism × Native Desktop Utility**

Tham khảo hình ảnh Lanvory đã được cung cấp trong project context.

Nếu reference image tồn tại trong repository, phải đọc và sử dụng như visual direction.

Không sao chép nguyên trạng layout nếu layout đó mang tính landing page.

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

Giao diện phải tạo cảm giác được thiết kế bởi một product designer có chủ đích, chú trọng functional hierarchy, pixel alignment và typography.

Không tạo một generic AI dashboard.

### Design References

Có thể nghiên cứu tinh thần thiết kế của:

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

Không clone bất kỳ sản phẩm nào.

---

## 33. ANTI-GENERIC AI DESIGN RULES

Đây là phần bắt buộc đối với toàn bộ UI.

### Avoid

- Excessive gradient backgrounds.
- Neon glow trên mọi component.
- Glassmorphism.
- Floating glass cards.
- Oversized rounded cards.
- Bento grid trên mọi screen.
- Generic dashboard templates.
- Large landing-page hero chiếm phần lớn desktop workspace.
- Unnecessary decorative illustrations.
- Generic globe illustration.
- AI-style futuristic network graphics.
- Excessive shadows.
- Multiple competing accent colors.
- Gradient text.
- Unnecessary animations.
- Random decorative status pills.
- Excessive whitespace không có chức năng.
- Duplicate information.
- Large marketing copy trên functional screens.
- Fake charts.
- Fake statistics.
- Excessive use of badges.
- Default shadcn/ui appearance không được tùy biến.

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

Không làm giao diện quá cầu kỳ chỉ để chứng minh rằng nó không giống AI-generated design.

Không sử dụng phong cách Victorian, royal luxury hoặc ornamental gold UI.

Sự sang trọng phải đến từ typography, restraint, layout và attention to detail.

---

## 34. DESIGN SYSTEM

Tạo `DESIGN_SYSTEM.md`.

Thiết kế toàn bộ UI thông qua semantic design tokens.

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

Accent color chỉ sử dụng có chủ đích.

Màu xanh lá dành chủ yếu cho active network, connected state và operational status.

Không phủ toàn bộ UI bằng màu neon green.

Kiểm tra contrast và accessibility trước khi chốt palette.

### Typography

Preferred fonts:

- IBM Plex Mono.
- Geist Mono.
- JetBrains Mono.
- Inter.
- System UI fonts.

Sử dụng monospace cho:

- IP addresses.
- Fingerprints.
- Port numbers.
- Device metadata.
- Technical labels.
- Status bar.

Sử dụng sans-serif hoặc monospace có chủ đích cho section headings và body text.

Không dùng một font monospace quá dày đặc đến mức giảm readability.

Fonts phải được đóng gói local, có license phù hợp.

Không tải Google Fonts tại runtime.

### Suggested Type Scale

```text
Page title:       24–28px
Section title:    15–18px
Primary text:     13–14px
Secondary text:   12–13px
Technical label:  11–12px
Status text:      11–12px
```

Oversized italic typography chỉ sử dụng tại onboarding hoặc welcome state nếu phù hợp.

Không sử dụng font size marketing cho mọi functional screen.

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

Pill shape chỉ sử dụng khi component thực sự phù hợp.

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

Thiết kế logo riêng cho Lanvory.

Logo phải:

- Simple.
- Geometric.
- Recognizable at small sizes.
- Monochrome-compatible.
- Suitable for macOS Menu Bar.
- Suitable for Windows System Tray.
- Suitable for application icon.
- Suitable for dark/light appearance.

### Logo Concept

Ưu tiên một geometric monogram dựa trên chữ L, kết hợp với hình ảnh hai hoặc ba node kết nối trực tiếp.

Logo phải thể hiện:

- Local connectivity.
- Peer-to-peer.
- Decentralization.
- Independence.

Không sử dụng:

- Generic AI atom icon.
- OpenAI-like knot.
- Generic glowing hexagonal mesh.
- Random 3D cube.
- Generic shield-only icon.
- Stock network logo.

Logo chính nên sử dụng flat vector geometry.

Chuẩn bị:

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

Kiểm tra logo tại kích thước 16px, 24px, 32px, 64px và 512px.

Không tuyên bố logo hoặc thương hiệu độc quyền nếu chưa tra cứu pháp lý.

---

## 36. DESKTOP WINDOW LAYOUT

Desktop layout phải mang tính ứng dụng sử dụng hằng ngày.

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

Desktop minimum dimensions phải được xác định sau khi kiểm thử nội dung thực tế.

Sidebar có thể collapse.

Inspector có thể đóng mở.

Các màn hình phải sử dụng không gian hiệu quả.

Không cần hiển thị inspector khi chưa có selection.

### Native Window Controls

macOS sử dụng traffic-light controls phù hợp.

Windows sử dụng minimize, maximize, close.

Không hiển thị cả hai loại controls trên cùng một platform.

Ưu tiên native desktop behavior.

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

Có thể thêm feature entry khi functionality đã được triển khai.

Không đưa những tính năng chưa tồn tại vào primary navigation chỉ để UI trông đầy đủ.

### Sidebar Requirements

- Compact logo and wordmark.
- Active navigation indicator.
- Functional icons.
- Navigation groups.
- Keyboard accessibility.
- Collapsible behavior.
- Local network status.
- Application settings access.

Không cần logo kích thước lớn chiếm phần lớn sidebar.

---

## 38. OVERVIEW SCREEN

Overview là operational dashboard, không phải landing page.

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

Sử dụng compact information sections.

Có thể sử dụng inline metrics:

```text
04 devices online    03 trusted    02 active syncs
```

Không bắt buộc biến mọi metric thành card riêng.

Chỉ sử dụng chart khi có historical data và mục đích rõ ràng.

Welcome headline chỉ xuất hiện có chọn lọc khi mới onboarding hoặc chưa có paired device.

---

## 39. DEVICES SCREEN

Đây là một trong những screen quan trọng nhất.

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

Selected row hiển thị inspector.

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

Không hiển thị action nếu peer không hỗ trợ hoặc user không có permission.

Giải thích disabled state khi cần.

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

Hiển thị incoming request bằng native notification hoặc trong-app notification phù hợp.

Không tự động accept incoming files mặc định.

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

Không hiển thị local file path của remote device nếu peer không chủ động chia sẻ thông tin đó.

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

Hiển thị warnings nếu local target đang không reachable.

Không trực tiếp expose port ra public network.

---

## 44. NETWORK SCREEN

### Layout

- Local network details.
- Peer topology visualization.
- Active connections.
- Network interface selection.
- Connection details.

Sử dụng dotted-grid background có chủ đích tại network visualization canvas.

Visual graph phải có mục đích kỹ thuật, không sử dụng hình cầu hoặc particles chỉ để trang trí.

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

Hiển thị local activity history:

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

Không lưu sensitive payload trong activity event.

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

Không yêu cầu account hoặc remote connection để thay đổi settings.

---

## 47. ONBOARDING

First launch phải đơn giản.

### Step 1 — Welcome

Hiển thị:

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

Người dùng có thể hoàn thành onboarding khi chưa có thiết bị khác online.

Không tạo mandatory signup flow.

Không sử dụng social login.

### Empty State

Khi chưa tìm được peer:

- Giải thích rằng các thiết bị cần chạy Lanvory.
- Kiểm tra cùng LAN.
- Kiểm tra firewall.
- Cung cấp refresh.
- Cung cấp manual pairing.
- Không yêu cầu Internet.

---

## 48. SYSTEM TRAY & MENU BAR

Lanvory phải hỗ trợ macOS Menu Bar và Windows System Tray.

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

Tray icon phản ánh trạng thái thực tế.

### Lifecycle

Phân biệt:

- Close window.
- Quit GUI.
- Stop daemon.
- Disable discovery.
- Pause synchronization.

Không âm thầm tiếp tục file transfer hoặc network listening sau khi người dùng chọn stop daemon.

Cung cấp lifecycle settings rõ ràng.

---

## 49. COMMAND PALETTE & KEYBOARD SHORTCUTS

Xây dựng keyboard-first interaction.

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

Không sử dụng global shortcut gây xung đột với hệ điều hành nếu không được người dùng cho phép.

---

## 50. SECURITY THREAT MODEL

Tạo `docs/security/threat-model.md`.

Giả định LAN là hostile environment.

Không coi private IP address là security guarantee.

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

Mỗi sensitive feature phải có security acceptance criteria.

Không tự động giảm security để làm demo hoạt động.

---

## 51. PRIVACY REQUIREMENTS

Tạo `PRIVACY.md`.

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

Mọi asset cần thiết cho runtime phải được đóng gói local.

User phải có quyền:

- Disable discovery.
- Change device visibility.
- Review permissions.
- Revoke trust.
- Delete transfer history.
- Delete activity history.
- Reset local application data.

Phải giải thích dữ liệu nào vẫn tồn tại trên receiving peer sau khi file transfer hoặc sync thành công.

Không tuyên bố ứng dụng hoàn toàn anonymous chỉ vì không có account.

mDNS metadata có thể được nhìn thấy bởi những thiết bị khác trong LAN.

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
- Tray integration khi hỗ trợ.
- AppImage hoặc phù hợp.
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

Lanvory phải là lightweight desktop utility trong phạm vi khả năng của Electron.

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

Ưu tiên event-driven updates thay vì polling liên tục.

Không thực hiện blocking file hashing trong Electron renderer.

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

Không sử dụng remote Prometheus hoặc external monitoring infrastructure làm runtime dependency.

Diagnostics và metrics phải được thu thập tại local.

Export chỉ thực hiện khi người dùng yêu cầu.

---

## 55. OFFLINE BEHAVIOR

Lanvory phải hoạt động khi Internet unavailable.

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
- Queue explicitly approved sync or transfer operations khi phù hợp.
- Retry with bounded backoff.
- Resume khi peer online.
- Allow cancellation.

Không gửi dữ liệu đến third-party service để lưu tạm.

Nếu receiving device không online, sender phải giữ dữ liệu hoặc transfer state tại local.

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
- Pairing MITM simulation trong môi trường kiểm thử cô lập.

Không tuyên bố LAN discovery đã verified chỉ dựa trên loopback tests.

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

Record environment, hardware, version và actual results.

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
- Native dialogs nếu test environment hỗ trợ.
- Pairing interaction.
- File transfer progress.
- Settings persistence.
- Daemon disconnect.
- Reconnection.
- Error recovery.

### Visual Review

Kiểm tra screenshot thật của application.

So sánh với DESIGN_SYSTEM.md.

Review:

- Typography.
- Spacing.
- Alignment.
- Contrast.
- Native desktop feel.
- Information density.
- Color consistency.
- Functional hierarchy.

Không tự đánh giá UI đã đẹp chỉ dựa trên source code.

Development preview sử dụng mock data phải được đánh dấu rõ và không tồn tại trong production flow.

---

## 58. CI/CD

Sử dụng GitHub Actions.

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
- Code signing khi có credentials.
- Notarization khi được cấu hình.

GitHub Actions chỉ phục vụ build/test/release.

Không biến CI/CD infrastructure thành runtime dependency.

Không tự ý publish release hoặc push source code nếu chưa được cấp quyền.

---

## 59. APPLICATION PACKAGING

Ứng dụng phải có thể cài đặt bình thường trên máy người dùng.

Không yêu cầu user cài riêng:

- Go runtime.
- Node.js runtime.
- pnpm.
- SQLite server.
- Docker.
- Development toolchain.

Go daemon phải được bundle đúng platform và architecture.

### Packaging Requirements

- Binary integrity verification phù hợp.
- Correct executable permissions.
- Daemon path resolution.
- Installed app path handling.
- First launch initialization.
- Local application data directory.
- Upgrade migration.
- Uninstall behavior.
- Identity persistence policy.
- Secure data reset.

Phải phân biệt:

- Uninstall application.
- Remove application data.
- Reset device identity.

Không tự động xóa dữ liệu của người dùng khi uninstall nếu không có chính sách và confirmation phù hợp.

### Update Requirements

Ứng dụng không phụ thuộc vào auto-update server.

Hỗ trợ manual installation of new releases.

Nếu bổ sung update checking trong tương lai, phải opt-in, minh bạch và không ảnh hưởng offline functionality.

---

## 60. DOCUMENTATION

Tạo documentation đầy đủ.

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

Sử dụng Mermaid cho architecture diagrams, sequence diagrams và state machines.

Documentation phải phản ánh implementation thực tế.

---

## 61. IMPLEMENTATION ROADMAP

Không triển khai toàn bộ feature cùng lúc.

Sử dụng vertical slices.

Mỗi phase phải tạo ra functionality chạy được và có acceptance criteria rõ ràng.

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

Architecture, security boundaries và development strategy được ghi nhận đầy đủ.

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

Desktop app chạy được, giao tiếp với daemon thật và hiển thị local device identity.

### Phase 2 — Local Discovery [`MVP`]

- mDNS.
- DNS-SD.
- Peer registry.
- Network interface monitoring.
- Device presence.
- Manual discovery.
- Devices screen.

Exit criteria:

Hai thiết bị chạy Lanvory có thể phát hiện nhau trong LAN mà không có Internet.

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

Hai thiết bị thiết lập authenticated encrypted connection và từ chối peer chưa được cấp quyền đối với privileged operations.

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

Hai thiết bị có thể truyền file thực tế và xác minh integrity.

### Phase 5 — Service Sharing [`MVP`]

- Service registry.
- Local proxy.
- TCP stream forwarding.
- Permission enforcement.
- Services screen.
- Tunnel management.

Exit criteria:

Machine B có thể truy cập service bind trên localhost của Machine A thông qua authenticated LAN tunnel.

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

Ứng dụng có trải nghiệm desktop hoàn chỉnh, không phải website hoặc dashboard prototype.

### Phase 7 — Folder Synchronization [`POST_MVP`]

- Filesystem monitoring.
- Sync manifest.
- Version tracking.
- Incremental sync.
- Conflict management.
- Deletion protection.
- Sync screen.

Exit criteria:

Hai thiết bị đồng bộ folder hai chiều mà không ghi đè concurrent changes một cách âm thầm.

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

Không đánh dấu phase hoàn thành nếu exit criteria chưa được xác minh.

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

MVP chỉ được coi là verified khi:

1. Hai thiết bị độc lập chạy Lanvory.
2. Không cần tài khoản.
3. Không cần central server.
4. Không cần Cloud service.
5. Router có thể ngắt Internet.
6. Hai thiết bị discover được lẫn nhau nếu LAN cho phép mDNS.
7. Hai thiết bị pairing thành công.
8. Public key được xác minh.
9. Pairing tồn tại sau restart.
10. Thiết lập encrypted authenticated connection.
11. Untrusted peer bị từ chối truy cập tài nguyên.
12. Truyền file thực tế thành công.
13. File checksum khớp.
14. Incoming transfer cần approval mặc định.
15. Shared localhost service hoạt động.
16. Local tunnel được giới hạn đúng resource.
17. Revoked peer mất quyền truy cập.
18. Network disconnect được xử lý.
19. Reconnect hoạt động khi peer trở lại.
20. UI phản ánh dữ liệu thật.
21. Daemon hoạt động đúng lifecycle.
22. Local settings được lưu.
23. Secret không xuất hiện trong logs.
24. Build thành công.
25. Automated tests pass.
26. Known limitations được ghi nhận.
27. MVP acceptance measurements in §53 meet their targets on the applicable baseline.
28. The MVP desktop rows in §52 have the required native and physical evidence. For a public release, apply the separate signing and notarization gate.

Record physical evidence for criteria 1–19 through the two-device run. Local source, test, build and desktop evidence may cover criteria 20–26 where applicable. Record each measurement and matrix row separately.

Không coi screenshot đẹp hoặc mock data là bằng chứng MVP hoàn thành.

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
- Schema validation tại trust boundaries.
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
- Large generated code that không có mục đích rõ ràng.

Sử dụng tiếng Anh cho source code, technical naming và documentation.

Báo cáo tiến độ với người dùng bằng tiếng Việt.

---

## 65. AGENT EXECUTION PROTOCOL

Khi bắt đầu, phải trực tiếp làm việc trên repository.

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

Không overwrite thay đổi hiện tại của người dùng.

### Step 2 — Research

Nghiên cứu technical requirements quan trọng trước khi chọn implementation.

Ghi lại:

- Source.
- Requirement.
- Decision.
- Tradeoff.
- Security implications.
- License implications.

### Step 3 — Plan

Tạo ROADMAP.md và TASKS.md.

Mỗi task phải có:

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

- Chọn task có dependencies đã đáp ứng.
- Tạo implementation thực tế.
- Viết tests.
- Cập nhật documentation.
- Kiểm tra integration.
- Review security.

### Step 5 — Verify

Thực thi:

- Formatter.
- Lint.
- Type checking.
- Unit tests.
- Integration tests.
- Build.
- Relevant security checks.

Không tuyên bố command pass nếu chưa chạy.

### Step 6 — Fix

Nếu test fail:

- Xác định root cause.
- Sửa lỗi tại đúng layer.
- Thêm regression test.
- Chạy lại verification.

Không sửa test theo hướng bỏ qua behavior sai.

### Step 7 — Continue

Sau khi hoàn thành task:

- Update TASKS.md.
- Update ROADMAP.md.
- Update HANDOFF.md.
- Record architecture decisions.
- Continue next task.

Không dừng lại sau khi tạo scaffold.

Continue independent tasks within the authorized scope when a task needs unavailable hardware, an OS, hosted CI access or signing credentials. In TASKS.md and HANDOFF.md, record the affected criteria, available evidence, missing evidence, exact prerequisites and reproduction steps. Use `UNVERIFIED` when implementation is ready and only verification is outstanding, or `BLOCKED` when the missing prerequisite prevents implementation. Keep `IN_PROGRESS` while feasible work remains on the same task. A blocked verification dependency stays open for dependent acceptance claims.

Stop when the requested scope is satisfied or every remaining in-scope task requires a blocker to be resolved. Existing authorization requirements still apply to hardware access, credentials, spending, destructive operations, release publication and changes to firewall, router or system security settings.

---

## 66. PERSISTENT PROJECT MEMORY

Tạo:

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

Phải ghi nhận:

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

Khi một agent session mới bắt đầu:

1. Đọc instructions.
2. Kiểm tra Git status.
3. Đọc project documents.
4. Kiểm tra source code thực tế.
5. Xác minh trạng thái task.
6. Tiếp tục task chưa hoàn thành.
7. Không khởi tạo lại project.
8. Không thay đổi architecture tùy tiện.

Source code, build output và test results là bằng chứng chính xác hơn progress notes.

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

Không yêu cầu bất kỳ central server hoặc cloud infrastructure nào để chạy sản phẩm.

---

## 69. FINAL EXECUTION INSTRUCTION

Continue work in the current repository within the user's authorized scope. For an unqualified request to implement or finish Lanvory, default to `MVP`. Start `POST_MVP` or `FUTURE` implementation only when requested.

Không chỉ trả lời bằng giải thích, kế hoạch hoặc code snippets.

Thực hiện theo thứ tự:

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

Sau mỗi phase, báo cáo bằng tiếng Việt:

- Completed.
- Modified files.
- Architecture decisions.
- Commands executed.
- Actual test results.
- Security considerations.
- Known limitations.
- Blockers.
- Next tasks.

Ưu tiên:

Security > Correctness > Reliability > Functionality > User Experience > Maintainability > Performance.

Không hy sinh security hoặc correctness để đẩy nhanh tiến độ.

Lanvory phải là một ứng dụng desktop networking thực sự hoạt động trong local network, không phải prototype, không phải cloud service, không phải VPN clone và không phải generic AI-generated dashboard.

Final product philosophy:

Your devices.
Your network.
Your rules.

No cloud.
No accounts.
No central servers.

# Known Limitations Report

This document records the known technical limitations, architectural boundaries, platform constraints, and design invariants of the Lanvory platform in compliance with [PROJECT_SPEC.md](../../PROJECT_SPEC.md) (Deliverable 35 & MVP Acceptance Criterion 26).

---

## 1. Networking & Scope Boundaries

### Same-Subnet Requirement
- Lanvory enforces strict interface-scoped networking. Peer discovery and scope validation default to literal IPv4 endpoints within the CIDR prefix of the user-approved network adapter.
- Traffic across routed subnets or complex multi-VLAN architectures without direct Layer 2/3 routing is rejected by default to prevent unintentional packet leakage.

### Client Isolation (AP Isolation)
- In enterprise or guest Wi-Fi networks where Access Point (AP) Client Isolation is enabled by the router/administrator, direct device-to-device communication over the LAN adapter (both UDP multicast mDNS and unicast TCP/QUIC) is dropped by the network hardware.
- On macOS, enabling **Bluetooth + P2P** (`lanvory-nearby` via CoreBluetooth and AWDL) provides a direct peer-to-peer path between nearby Macs without relying on the router. Lanvory strictly adheres to zero-cloud and no-central-relay principles and will never route traffic through external servers.

### Session-Scoped Listener
- Starting the network listener (TCP, QUIC, and Bonjour registration) is intentionally session-scoped. Restarting the daemon resets the listener to `stopped` until explicitly enabled by the user via the UI ("Turn on LAN") or CLI (`lanvory network listener start`). This prevents unattended exposure after system reboots.

---

## 2. File Transfer, Sync, and Mount Limitations

### Single-File Drop & Folder Capabilities
- The Drop wire protocol (`lanvory-drop/1`) handles one regular file per transfer session (up to 1 GiB), verified with SHA-256 digest and atomic filesystem commit.
- Multi-file directory synchronization (`send-only`, `receive-only`, `two-way`) is handled by Folder Sync (`core/internal/sync`), and live folder browsing/editing is handled by Live Resource Mount (`lanvory-mount/1` WebDAV over mTLS, `core/internal/mount`).

### Fixed Destination Directory
- Received files are written strictly to `~/.lanvory/inbox` (or `$LANVORY_STATE_DIR/inbox`) with strict `0700` directory and `0600` file permissions to prevent path traversal and arbitrary filesystem writes. Custom destination directories require future explicit security scoping.

---

## 3. Platform & Packaging Constraints

### macOS Code Signing & Notarization
- Local and CI-built macOS disk images (`.dmg`) are signed with ad-hoc certificates. Running on another Mac requires removing the quarantine attribute (`xattr -cr /Applications/Lanvory.app`) or manual Gatekeeper approval until Developer ID credentials and Apple Notarization are configured.

### Local Device Identity Storage
- The Ed25519 device identity seed is stored directly in `<state-dir>/identity.key` (default `~/.lanvory/identity.key`) with strict owner-only (`0600`) permissions inside an owner-only (`0700`) directory, avoiding macOS Keychain authorization prompts during installation and startup.

### Windows & Linux Desktop Status
- Historical Linux core verification (SQLite migrations, Unix IPC, interface binding, and GNOME Keyring identity persistence) was validated in containers, and the `linux-core` GitHub Actions job was removed while active development targets macOS (`arm64` & `x64`).
- Windows Named Pipe and Credential Manager architectures are specified in [cross-platform.md](../architecture/cross-platform.md), with native Windows and Linux desktop builds scheduled for later phases.

---

## 4. Hardware Verification Dependency

- Full acceptance of tasks `LAN-01`, `LAN-02`, `DROP-02`, `BRIDGE-03`, `SHARE-01`, and `MVP-01` requires two physical hosts on an isolated test LAN with WAN disconnected. Automated loopback and container tests provide regression coverage but cannot simulate real wireless hardware transitions or physical network adapter disconnections.

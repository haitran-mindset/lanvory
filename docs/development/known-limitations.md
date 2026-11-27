# Known limitations

This document records the known technical limitations, architectural boundaries, platform constraints, and design invariants of the Lanvory platform in compliance with [PROJECT_SPEC.md](../../PROJECT_SPEC.md) (Deliverable 35 & MVP Acceptance Criterion 26).

---

## 1. Networking & Scope Boundaries

### Same-Subnet Requirement
- Lanvory enforces strict interface-scoped networking. Peer discovery and scope validation default to literal IPv4 endpoints within the CIDR prefix of the user-approved network adapter.
- Traffic across routed subnets or complex multi-VLAN architectures without direct Layer 2/3 routing is rejected by default to prevent unintentional packet leakage.

### Client Isolation (AP Isolation)
- In enterprise or guest Wi-Fi networks where Access Point (AP) Client Isolation is enabled by the router/administrator, direct device-to-device communication over the LAN adapter (both UDP multicast mDNS and unicast TCP/QUIC) is dropped by the network hardware.
- On macOS, [Bluetooth + Wi-Fi P2P](../protocols/nearby.md) can provide a direct path between nearby Macs when the system grants Bluetooth and network permissions and a Wi-Fi P2P connection can be established. A BLE result alone does not guarantee connectivity.

### Session-Scoped Listener
- Starting the network listener (TCP, QUIC, and Bonjour registration) is intentionally session-scoped. Restarting the daemon resets the listener to `stopped` until explicitly enabled by the user via the UI ("Turn on LAN") or CLI (`lanvory network listener start`). This prevents unattended exposure after system reboots.

---

## File transfer, sync, and mount

### Single-File Drop & Folder Capabilities
- The Drop wire protocol (`lanvory-drop/1`) handles one regular file per transfer session (up to 1 GiB), verified with SHA-256 digest and atomic filesystem commit.
- Multi-file directory synchronization uses [Folder Sync](../protocols/sync.md). Live folder browsing and editing use [Live Resource Mount](../protocols/mount.md).

### Folder Sync conflict handling

- Sync compares whole-file SHA-256 hashes and uses modification times to choose the transfer direction when both folders are bidirectional. Clock differences can change which version wins.
- Conflict copies are best effort. Repeated conflicts on the same path, peer label, and UTC day can target the same filename. Folder Sync does not merge file contents, propagate deletions, or apply a multi-file sync as one transaction.

### Fixed Destination Directory
- Received files are written strictly to `~/.lanvory/inbox` (or `$LANVORY_STATE_DIR/inbox`) with strict `0700` directory and `0600` file permissions to prevent path traversal and arbitrary filesystem writes. Custom destination directories require future explicit security scoping.

---

## Screen Sharing

- [Screen Sharing](../protocols/screen-sharing.md) supports one viewer on a shared LAN between paired Macs. AWDL screen sharing, system audio, remote control, and recording are excluded.
- The adaptive JPEG path targets up to 12 fps. Frame rate and readability depend on network latency, capture size, and machine load. Offline end-to-end acceptance on two physical Macs is still pending.
- Leaving the feature or hiding the app stops the active session. The sender needs macOS Screen Recording permission.

## 3. Platform & Packaging Constraints

### macOS Code Signing & Notarization
- Local and CI-built macOS disk images (`.dmg`) are signed with ad-hoc certificates. Running on another Mac requires removing the quarantine attribute (`xattr -cr /Applications/Lanvory.app`) or manual Gatekeeper approval until Developer ID credentials and Apple Notarization are configured.

### Release notices and manual updates

- The macOS app can show that a newer stable release is available and open the matching DMG in a browser. Installing the DMG and relaunching Lanvory are manual steps.
- The version check ignores equal versions. A replacement build published under the same version requires downloading and reinstalling it manually. See [macOS packaging](../deployment/macos.md).

### Local Device Identity Storage
- The Ed25519 device identity seed is stored directly in `<state-dir>/identity.key` (default `~/.lanvory/identity.key`) with strict owner-only (`0600`) permissions inside an owner-only (`0700`) directory, avoiding macOS Keychain authorization prompts during installation and startup.

### Windows & Linux Desktop Status
- Historical Linux core verification (SQLite migrations, Unix IPC, interface binding, and GNOME Keyring identity persistence) was validated in containers, and the `linux-core` GitHub Actions job was removed while active development targets macOS (`arm64` & `x64`).
- Windows Named Pipe and Credential Manager architectures are specified in [cross-platform.md](../architecture/cross-platform.md), with native Windows and Linux desktop builds scheduled for later phases.

---

## 4. Hardware Verification Dependency

- See the [two-device validation runbook](lan-validation.md). Full acceptance of tasks `LAN-01`, `LAN-02`, `DROP-02`, `BRIDGE-03`, `SHARE-01`, and `MVP-01` requires two physical hosts on an isolated test LAN with WAN disconnected. Automated loopback and container tests provide regression coverage but cannot simulate real wireless hardware transitions or physical network adapter disconnections.

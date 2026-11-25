# Cross-Platform Architecture & Platform Boundaries

Lanvory is designed as an offline-first, peer-to-peer desktop networking platform. While the initial vertical slices target macOS, the architecture is designed for multi-platform parity across macOS, Linux, and Windows without introducing centralized services, cloud intermediaries, or loosening security invariants.

---

## 1. Security & Trust Boundaries

The security model is uniform across all supported operating systems:
- **Local Ownership**: Every device manages its private keys, trusted peers, permission grants, and local state exclusively on the local machine.
- **Owner-Only IPC**: Only local processes running under the authenticated user account may communicate with the background daemon (`lanvoryd`).
- **Default-Deny Privileged Operations**: Untrusted peers cannot access protected resources (files, services, clipboard, tunnels). All incoming transfer requests require explicit user authorization.
- **Kernel Interface Scope**: All network traffic is strictly bound to user-approved local network interfaces and validated against local LAN subnets, rejecting loopback, multicast, public IP, and off-link destinations.

---

## 2. Platform Comparison Matrix

| Architectural Area | macOS (Current) | Linux (Target) | Windows (Target) |
| :--- | :--- | :--- | :--- |
| **Secure Key Store** | Apple Keychain (`Security.framework`) | Freedesktop Secret Service via D-Bus (`libsecret` / GNOME Keyring / KWallet) | Windows Credential Manager (`wincred`) or DPAPI (`CryptProtectData`) |
| **Local IPC Channel** | Unix Domain Socket with effective UID peer verification (`LOCAL_PEERCRED` / `getpeereid`) | Unix Domain Socket with `SO_PEERCRED` checking caller UID | Windows Named Pipe (`\\.\pipe\lanvory-<user-sid>`) with restrictive DACL |
| **Kernel Interface Binding** | `IP_BOUND_IF` / `SO_DONTROUTE` socket options | `SO_BINDTODEVICE` (`bind_linux.go`) | `IP_UNICAST_IF` (`setsockopt` with interface index) |
| **Service Discovery** | Native Bonjour / mDNS (`dns_sd.h` / Cgo / Zeroconf) | Avahi D-Bus API or embedded mDNS UDP (`5353`) | Windows DNS-SD (`dnssd.dll`) or embedded mDNS UDP |
| **Local Persistence** | SQLite 3 (`0600` permissions, symlink rejection) | SQLite 3 (`0600` permissions, symlink rejection) | SQLite 3 (restricted ACLs via Windows filesystem) |
| **Desktop Packaging** | DMG (arm64, x64) signed ad-hoc / Developer ID | AppImage, `.deb`, `.rpm`, `.tar.gz` | NSIS installer, portable `.zip` |

---

## 3. Linux Platform Design

### Credential Storage
The Ed25519 device identity seed is stored securely using the Freedesktop Secret Service API over the session D-Bus:
- **Service Name**: `lanvory.local`
- **Attributes**: `app=lanvory`, `service=device-identity`
- **Fallback**: For headless or containerized Linux environments (e.g., CI/CD), the daemon accepts a local protected keyfile with explicit `0600` permissions and ownership checks, with warning logs emitted.

### Local IPC
- The daemon binds a Unix domain socket at `$XDG_RUNTIME_DIR/lanvory/daemon.sock` (falling back to `~/.lanvory/daemon.sock` with directory permissions `0700`).
- Every connection handshake inspects `SO_PEERCRED` via `syscall.GetsockoptUcred` to verify the caller UID matches `os.Geteuid()`.

### Interface Binding
- Peer listeners and outbound dials apply `SO_BINDTODEVICE` with the interface name (e.g., `eth0`, `wlan0`), implemented in `core/internal/peer/bind_linux.go`.

---

## 4. Windows Platform Design

### Credential Storage
- Primary store: Windows Credential Manager via `CredWriteW` / `CredReadW` under target name `lanvory:device-identity`.
- Secondary/Fallback: Windows Data Protection API (DPAPI) via `CryptProtectData` with `CRYPTPROTECT_UI_FORBIDDEN`, scoping encryption to the current Windows user profile (`CurrentUser`).

### Local IPC
- The daemon creates a Windows Named Pipe at `\\.\pipe\lanvory-<UserSID>\daemon.pipe`.
- The Named Pipe security descriptor is created using `CreateNamedPipeW` with an explicit Discretionary Access Control List (DACL) granting `GENERIC_READ | GENERIC_WRITE` solely to the current user's security identifier (SID), denying `Network` and `RemoteInteractive` access.

### Interface Binding
- Sockets are bound to the approved adapter index using `IP_UNICAST_IF` for IPv4 unicast traffic, preventing packets from leaking through unapproved adapters or virtual VPN adapters.

---

## 5. Packaging & Verification

1. **Linux**: Built as an AppImage bundling Electron, the precompiled Go binaries (`lanvory`, `lanvoryd`), licenses, and CycloneDX SBOM. Validated in isolated container environments.
2. **Windows**: Packaged via Electron Builder with an NSIS installer and portable executable, producing SHA-256 sidecars and CycloneDX inventories matching the macOS pipeline.

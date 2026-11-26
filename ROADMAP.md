# Roadmap

The MVP targets macOS on Apple Silicon and uses the existing Go daemon and Electron desktop architecture.
| Scope | Delivery order and acceptance |
| --- | --- |
| `MVP` | Deliver phases 0–6 for the macOS arm64 desktop and the baseline diagnostics and hardening from phases 9 and 11. Validate the offline LAN slice, local DMG, and measurable targets in [PROJECT_SPEC.md](PROJECT_SPEC.md#53-performance-requirements). Public distribution has a separate signed release gate (`v0.1.0` tagged with ad-hoc macOS `arm64`/`x64` GitHub Release workflow). |
| `POST_MVP` | Complete physical two-host validation for Folder Sync, shared clipboard, Network Explorer, Live Resource Mount V2, and Bluetooth + Wi-Fi P2P (AWDL). Extend native desktop acceptance to Intel macOS, signed/notarized macOS releases, and Linux desktop. |
| `FUTURE` | Schedule Local Messaging, the SDK, Automation, Backup, and Windows desktop after explicit authorization. |

See the [requirement groups](PROJECT_SPEC.md#requirement-groups) and [compatibility matrix](PROJECT_SPEC.md#compatibility-matrix) for the scope and acceptance of each milestone.

## Current state

Terminal, SSH, and remote command execution are deferred outside the current implementation plan.

| Area | Implemented and checked locally on macOS | Remaining verification or implementation |
| --- | --- | --- |
| Foundation | Electron, Go daemon, owner-authenticated local IPC, CLI, SQLite migrations, persisted identity, local preferences, and daemon recovery | Remaining MVP settings and macOS lifecycle integration |
| Discovery | Approved-adapter Bonjour browse, publication and resolution for TCP and UDP, Bluetooth + Wi-Fi P2P (AWDL) via `lanvory-nearby`, manual endpoint fallback, and local endpoint filtering | Discovery and recovery after network changes across two physical hosts with WAN disconnected |
| Pairing and transport | Pinned identity verification, explicit confirmation on both devices, persisted trust, revocation, mutual TLS, scoped QUIC, and timeout-only TCP fallback | Physical pairing, restart persistence, scope and revocation, and preferred/fallback transport checks |
| Drop and Bridge | Approved single-file transfer, progress and history, service grants, and local-only tunnel binding, with automated and native desktop smoke checks | File approval, checksum, and history from actual transfers, plus remote tunnel relay and revocation on two physical hosts |
| Sync, Mount, and Clipboard | Folder Sync (`send-only`, `receive-only`, `two-way`), Live Resource Mount V2 (`lanvory-mount/1` WebDAV over mTLS), shared clipboard, and Network Explorer `ping` | Physical two-host validation for concurrent sync, live WebDAV mount editing, and clipboard exchange |
| Desktop and packaging | Fixed navigation and page headings, dual status card (`Local Network` + `Bluetooth + P2P`), sidebar version badge (`v0.1.0`), native window lifecycle, ad hoc macOS DMG (`arm64`/`x64`) bundling `lanvory-nearby` with SBOM/SHA-256, GitHub Release workflow, and `apps/web` site | Full offline MVP acceptance, Developer ID signing and Apple notarization |
| Later phases | The macOS `v0.1.0` desktop and core feature set are implemented locally | Native Intel, Linux, and Windows desktop acceptance |

Use [TASKS.md](TASKS.md) for task-level acceptance criteria, [HANDOFF.md](HANDOFF.md) for verification evidence and the latest test image, and the [two-device runbook](docs/development/lan-validation.md) for the physical LAN gate.

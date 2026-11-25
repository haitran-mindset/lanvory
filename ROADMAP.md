# Roadmap

The MVP targets macOS on Apple Silicon and uses the existing Go daemon and Electron desktop architecture.
| Scope | Delivery order and acceptance |
| --- | --- |
| `MVP` | Deliver phases 0–6 for the macOS arm64 desktop and the baseline diagnostics and hardening from phases 9 and 11. Validate the offline LAN slice, local DMG, and measurable targets in [PROJECT_SPEC.md](PROJECT_SPEC.md#53-performance-requirements). Public distribution has a separate signed release gate. Existing Linux core CI remains regression coverage outside MVP acceptance. |
| `POST_MVP` | Add Folder Sync, shared clipboard, Network Explorer, advanced Drop workflows, and command palette. Extend native desktop acceptance to Intel macOS and Ubuntu GNOME. |
| `FUTURE` | Schedule Local Messaging, the SDK, Automation, Backup, and Windows desktop after explicit authorization. |

See the [requirement groups](PROJECT_SPEC.md#requirement-groups) and [compatibility matrix](PROJECT_SPEC.md#compatibility-matrix) for the scope and acceptance of each milestone.

## Current state

Terminal, SSH, and remote command execution are deferred outside the current implementation plan.

| Area | Implemented and checked locally on macOS | Remaining verification or implementation |
| --- | --- | --- |
| Foundation | Electron, Go daemon, owner-authenticated local IPC, CLI, SQLite migrations, persisted identity, local preferences, and daemon recovery | Remaining MVP settings and macOS lifecycle integration |
| Discovery | Approved-adapter Bonjour browse, publication and resolution for TCP and UDP, manual endpoint fallback, and local endpoint filtering | Discovery and recovery after network changes across two physical hosts with WAN disconnected |
| Pairing and transport | Pinned identity verification, explicit confirmation on both devices, persisted trust, revocation, mutual TLS, scoped QUIC, and timeout-only TCP fallback | Physical pairing, restart persistence, scope and revocation, and preferred/fallback transport checks |
| Drop and Bridge | Approved single-file transfer, progress and history, service grants, and local-only tunnel binding, with automated and native desktop smoke checks | File approval, checksum, and history from actual transfers, plus remote tunnel relay and revocation on two physical hosts |
| Desktop and packaging | Fixed navigation and page headings, one-step LAN activation, native window lifecycle, and an ad hoc macOS arm64 DMG with signed bundle checks, SHA-256 and CycloneDX inventory | Full offline MVP acceptance, hosted macOS workflow execution, Developer ID signing and notarization |
| Later phases | The macOS MVP foundation is the current implementation focus | Native Intel and Linux desktop acceptance, later feature groups, and Windows desktop |

Use [TASKS.md](TASKS.md) for task-level acceptance criteria, [HANDOFF.md](HANDOFF.md) for verification evidence and the latest test image, and the [two-device runbook](docs/development/lan-validation.md) for the physical LAN gate.

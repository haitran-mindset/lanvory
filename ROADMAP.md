# Roadmap

Lanvory Desktop ships ad-hoc macOS builds for Apple Silicon and Intel. The MVP acceptance gate targets Apple Silicon.

## Delivery milestones

| Status | Milestone | Scope |
| --- | --- | --- |
| Available | macOS desktop | The [latest stable release](https://github.com/haitran-mindset/lanvory/releases/latest) includes LAN and Bluetooth + Wi-Fi P2P discovery, device pairing, Drop, Bridge, Folder Sync, Live Resource Mount, and update notices that link to a manual DMG install. |
| Current focus | Two-device validation | Verify offline discovery, pairing, file transfer, service sharing, Folder Sync, Live Resource Mount, and Screen Sharing across physical devices. Record the results using the [LAN validation runbook](docs/development/lan-validation.md). |
| Next | Signed macOS releases | Configure Developer ID signing and notarization, verify installation on both Mac architectures, and prepare for in-app updates. |
| Future | Windows and Linux | Extend native desktop coverage to Linux and plan Windows support. |

## Screen Sharing roadmap

| Stage | Scope |
| --- | --- |
| Implemented in source | One sender and one viewer on macOS over a shared LAN, with source previews, per-session consent, and a stop action on either side. [Screen Sharing guide](docs/protocols/screen-sharing.md) |
| Current focus | Validate two physical Macs with WAN disconnected. Measure time to first frame, frame rate, and latency. Test interruption, revocation, and stopping from either side. [Validation plan](docs/development/screen-sharing-plan.md#two-mac-acceptance) |
| Next | Improve text clarity and motion. Keep the latest-frame behavior and evaluate a persistent media connection or video codec with enforceable LAN adapter scope. |
| Future | Validate direct Wi-Fi (AWDL) without a shared router. Evaluate optional system audio with separate consent, then extend capture and viewing to additional desktop platforms. |

## Acceptance scope

| Scope | Delivery order and acceptance |
| --- | --- |
| `MVP` | Deliver phases 0–6 for the macOS arm64 desktop and the baseline diagnostics and hardening from phases 9 and 11. Validate the offline LAN slice, local DMG, and measurable targets in [PROJECT_SPEC.md](PROJECT_SPEC.md#53-performance-requirements). The GitHub Release workflow publishes ad-hoc macOS builds for `arm64` and `x64`. Developer ID distribution has a separate release gate. |
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
| Screen Sharing | Local capture verified in Electron; automated consent, frame transport, and session cleanup checks | Full offline session, latency, and sustained frame-rate measurements on two physical Macs |
| Desktop and packaging | Fixed navigation and page headings, dual status card (`Local Network` + `Bluetooth + P2P`), sidebar version badge, native window lifecycle, hosted verification of ad-hoc macOS DMGs (`arm64`/`x64`) with SBOM/SHA-256, GitHub Release update notices, and the `apps/web` site | Full offline MVP acceptance, Developer ID signing and Apple notarization |
| Later phases | The macOS desktop and core feature set are implemented locally | Native Intel, Linux, and Windows desktop acceptance |

Use [TASKS.md](TASKS.md) for task-level acceptance criteria, [HANDOFF.md](HANDOFF.md) for verification evidence and the latest test image, and the [two-device runbook](docs/development/lan-validation.md) for the physical LAN gate.

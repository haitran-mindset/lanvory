# Screen Sharing

Screen Sharing shows one window or display from a Mac on one paired Mac over a shared LAN. It is enabled by default on macOS starting with Lanvory 0.1.6. The viewer can see the shared picture and end the session.

## How to share

1. Connect both Macs to the same LAN, enable LAN in Lanvory, and pair the devices. Confirm that the viewer has a LAN address in **Paired devices** on the sender.
2. Open **Workspace → Screen Sharing** on both Macs.
3. On the sender, choose **Find windows and displays** and select a source from the thumbnail grid. If macOS opens Screen Recording settings, grant permission and reopen Lanvory.
4. Choose **Start local preview**, then confirm with **Preview**. Select the viewer under **Share with** and choose **Invite to view**.
5. On the viewer, choose **Accept**. Only the sender needs macOS Screen Recording permission.
6. Keep **Screen Sharing** open on both devices during the session. Either side can choose **End session**.

The local preview and thumbnails stay on the sender. The sender starts transmitting frames after the viewer accepts. Lanvory keeps the most recent frame in memory and does not record the session.

## Transport and permissions

- `lanvory-screen-signaling/1` carries invitations, decisions, session status, and JPEG frames over adapter-scoped TCP with mutual TLS. The daemon verifies saved Ed25519 peer identities and checks current LAN scope.
- An invitation expires after 45 seconds. A paired device must still accept each session. Accepted sessions have a two-hour maximum lifetime and stop after 15 seconds without new frames.
- The sender targets up to 12 fps and adapts JPEG resolution to processing and network conditions. Frames are limited to 42 KiB, and the receiver skips frames that have already been displayed.
- The current scope is macOS-to-macOS on a shared LAN. Audio, remote control, relay transport, and AWDL screen sharing are outside the current implementation.

See the [validation plan](../development/screen-sharing-plan.md), [known limitations](../development/known-limitations.md#screen-sharing), and [expansion roadmap](../../ROADMAP.md#screen-sharing-roadmap).

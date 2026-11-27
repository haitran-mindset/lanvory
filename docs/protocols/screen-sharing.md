# Screen Sharing

Screen Sharing shows one window or display from a Mac on one paired Mac over a shared LAN or an active Bluetooth + Wi-Fi P2P connection. It is enabled by default on macOS starting with Lanvory 0.1.6. The viewer can see the shared picture and end the session.

## How to share

1. Pair the Macs and confirm that the viewer has an active route in **Paired devices** on the sender. Use an approved LAN adapter or choose **Connect** in Bluetooth + Wi-Fi P2P discovery to establish the direct route. If a P2P route expires, reconnect before inviting again.
2. Open **Workspace → Screen Sharing** on both Macs.
3. On the sender, choose **Find windows and displays**. If macOS asks for screen recording permission, follow the system prompt. If access is still missing, Lanvory opens System Settings automatically. After enabling access, reopen Lanvory if macOS asks you to, then select a source from the thumbnail grid.
4. Choose **Start local preview**, then confirm with **Preview**. Select the viewer under **Share with** and choose **Invite to view**.
5. On the viewer, open the invitation from the Lanvory notification or the Screen Sharing page, then choose **Accept**. macOS can show the invitation while Lanvory is hidden or minimized. Lanvory fits the whole frame in the viewer and shows its received dimensions. Choose **Open viewer** for a separate window, then **Full screen** to enlarge it. Closing the viewer leaves the sharing session running in Lanvory. Only the sender needs macOS Screen Recording permission.
6. You can switch to another Lanvory page or to the app you are sharing. A dot by **Screen Sharing** indicates an active session. You can also hide or minimize Lanvory during the session. Choose **End session**, use **Stop Screen Sharing** from the macOS menu bar, or close the Lanvory window to stop.

The local preview and thumbnails stay on the sender. The sender starts transmitting frames after the viewer accepts. Lanvory keeps the most recent frame in memory and does not record the session.

## Transport and permissions

- `lanvory-screen-signaling/1` carries invitations, decisions, session status, and JPEG frames over mutually authenticated TLS on approved LAN adapters or registered local Wi-Fi P2P bridge endpoints. The daemon verifies saved Ed25519 peer identities. Bluetooth is used for discovery and Wi-Fi P2P carries the screen traffic.
- An invitation expires after 45 seconds. A paired device must still accept each session. Accepted sessions have a two-hour maximum lifetime and stop after 15 seconds without new frames.
- When both peers support connection reuse, the sender targets up to 30 fps over a single authenticated media connection. It keeps only one frame in flight and adapts JPEG resolution to encoding and connection delays. Both daemons recheck peer trust and connection scope during the session. When both peers advertise binary media, the sender writes raw JPEG bytes with a 29-byte header over TLS. Signaling remains JSON. Peers that support only the JSON media stream continue to use it. Older peers use the original per-frame connection and 12 fps target. When both devices support UHD, the sender can transmit up to 3840 × 2160 pixels and 640 KiB per JPEG. Actual resolution depends on the captured source, encoding time, and connection conditions. The sender falls back to lower profiles automatically. Older peers negotiate HD (up to 1920 px and 160 KiB) or the original 42 KiB mode. The sender can encode the next capture while the current frame is in transit. The receiver can listen for a new frame while decoding the previous one and keeps at most one waiting frame.
- The current scope is macOS-to-macOS. The P2P path has automated loopback coverage. Two-Mac AWDL acceptance without a shared router remains pending. Audio, remote control, and relay transport are outside the current implementation.

See the [validation plan](../development/screen-sharing-plan.md), [known limitations](../development/known-limitations.md#screen-sharing), and [expansion roadmap](../../ROADMAP.md#screen-sharing-roadmap).

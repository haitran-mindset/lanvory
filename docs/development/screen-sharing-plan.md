# Local-first P2P screen sharing

## First release

Offer a one-to-one, view-only session between paired desktops on an approved LAN. The sender selects a window or display and the receiver explicitly accepts the invitation. Show the selected source and viewer throughout the session. Either peer can end it. Capture and transport are video-only. No Internet services are required.

## Implementation

1. Validate local screen capture in Electron. Enumerate sources only after user interaction, grant only the selected source from the trusted main frame, and stop all capture tracks when the preview closes or the app is hidden. Exercise denied permissions, source closure, and retries in the packaged build.
2. Add ephemeral signaling over a dedicated authenticated peer protocol in the Go daemon. Reuse pinned peer identity and scoped adapter dialing. Verify both peers are still trusted, bind offers and answers to one expiring session, bound message sizes and outstanding requests, and expose invitation, response, and termination through local IPC. Add tests for unknown peers, replays, expiry, cancellation, and revocation.
3. Integrate WebRTC video with direct LAN host candidates and no public STUN or TURN. Route signaling through the authenticated session. Verify that candidate gathering and connectivity checks respect the approved interface and subnet, including on multi-homed machines. If Chromium cannot enforce that scope, move the media transport to a component that can bind to the approved adapter before enabling the feature.
4. Add Share screen for paired devices, a viewer, incoming invitations, and a persistent Stop sharing control. Terminate on peer disconnect, revocation, window closure, or track end. Keep audio, recording, and remote input outside this release.
5. Run the offline acceptance matrix on two physical Macs using the packaged app. Verify window and display capture with WAN disconnected, reject an invitation, stop from either side, revoke during playback, and test locking, sleep, adapter changes, and reconnection. Check that video and signaling stay on the approved path and evaluate latency, frame rate, and CPU use.
6. Validate AWDL separately on two Macs without a shared router. Advertise router-free sharing only after demonstrating the actual media path over AWDL.

## Implemented LAN pilot

Screen Sharing is enabled by default on macOS. It sends small JPEG frames to one viewer over Lanvory's scoped, mutually authenticated TCP path. The receiver keeps the latest frame in memory. There is no relay, Internet service, recording, audio, or remote input. Current peers reuse one mutually authenticated media connection over scoped LAN TCP or the registered Wi-Fi P2P bridge and target up to 30 frames per second. The renderer adapts JPEG resolution to the observed turnaround time and keeps at most one frame in flight. Reusable local CLI workers retain a same-user daemon socket for successive frames and forward each validated JSON reply without re-encoding the Base64 payload. The viewer waits briefly for the next frame instead of relying on a fixed polling interval. Current peers can negotiate binary JPEG frames over TLS to avoid Base64 overhead between the two daemons. Legacy peers use one connection per frame and target up to 12 frames per second.

### Local verification

On 2026-11-27, a real Electron run on macOS arm64 exercised Cancel and Preview in the confirmation window, enumerated a dedicated test window with a thumbnail, and started and stopped video-only capture. Go race tests exercised signaling, consent, encrypted frame exchange, expiry, revocation, and frame rejection after stop. These checks do not establish media performance or offline operation between two physical Macs.

### Two-Mac acceptance

1. Build the daemon and desktop app on both Macs with `make build`. Stop previous development instances before starting the new binaries. Run `pnpm --filter @lanvory/desktop start` on each Mac.
2. Join the same LAN, approve the correct adapter, turn on LAN in Lanvory and pair the Macs. On the sending Mac, verify that the peer has a LAN address in **Paired devices**. For the offline check, disconnect WAN while retaining the local network.
3. Open **Workspace → Screen Sharing** on both Macs. On the sending Mac, find sources, select one window or display, start the local preview, approve the confirmation dialog, then choose a peer and invite it to view. On the receiving Mac, accept the invitation and confirm that moving or changing the shared window updates the picture.
4. Repeat with a decline and with an expired invitation. Repeat with each side ending a live session. Switch Lanvory pages or apps, then hide or minimize Lanvory and confirm the live session continues. Close the Lanvory window, close the source window, and disconnect the selected LAN adapter in separate runs. Confirm the live session stops, the sender capture track ends and the receiver loses the picture.
5. Repeat invitation, viewing, and stop flows with LAN disabled in Lanvory and both Macs disconnected from any shared router. Use Bluetooth + Wi-Fi P2P to establish a route and verify that reconnecting restores the ability to invite after the link drops.
6. Compare the prior build and the current build on both routes. Record delivered FPS, median and 95th-percentile capture-to-display latency, sender and viewer CPU, and readability for a static document, rapid scrolling, and moving video.

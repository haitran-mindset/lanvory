# Folder Sync

Lanvory Folder Sync exchanges files between paired devices using `lanvory-sync/1` over mutually authenticated TLS 1.3 on scoped LAN TCP or a registered macOS Wi-Fi P2P loopback bridge (`SyncFolderLoopback`). The receiving daemon checks the authenticated peer's `folder-sync` grant for the requested folder ID. The owner registers a local directory on each device and chooses send-only, receive-only, or bidirectional mode.

## How SHA-256 is used

1. **Index files.** A scan records relative paths, byte counts, modification times, and SHA-256 content hashes. The index skips hidden entries, known ignored names, and symlinks.
2. **Compare manifests.** A file at the same relative path with the same SHA-256 is skipped. Different content or a missing file makes the path a transfer candidate when both folder modes permit the transfer.
3. **Verify before writing the final path.** The receiver streams bytes to a temporary file while computing SHA-256. A digest mismatch aborts the write and removes the temporary file. A verified file is moved into place.

## How conflict copies work

In a two-way sync, a newer local modification time selects the local file for upload. A newer remote modification time or a tie selects the remote file for download. This rule uses both devices' file timestamps, so clock differences can affect the winner.

Before a verified file replaces a different regular file in a bidirectional folder, the receiver attempts to rename the existing file to a conflict copy in the same directory. For example, `notes.txt` can become `notes.conflict-machine-b-20261126.txt`. The filename uses a device label and UTC date. The app records copies that the rename successfully creates.

The current protocol transfers whole files and applies each verified file independently. Conflict copies depend on a successful rename, and repeated conflicts for the same file, peer label, and UTC date can target the same name. Keep separate backups for important files. See [known limitations](../development/known-limitations.md#file-transfer-sync-and-mount) and the [Sync implementation](../../core/internal/sync/protocol.go).

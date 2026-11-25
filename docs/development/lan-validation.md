# Two-device LAN validation

## Optional same-host macOS preflight

On a controlled test LAN, substitute the active test adapter for `en0` and run from `core/`:

```sh
LANVORY_TEST_PEER_INTERFACE=en0 LANVORY_TEST_PEER_PUBLISH=1 \
  go test -race -count=1 -v ./internal/peer -run '^TestNative(Binding|QUICBinding)AndRevocation$'
```

These tests publish temporary service names and check TCP and UDP adapter binding, Bonjour resolution, same-host address filtering and withdrawal after test approval is revoked. Complete the two-device procedure below for acceptance.

## Two-device procedure

Use two macOS devices on the same Wi-Fi or Ethernet segment. Record the OS, DMG SHA-256 (or build revision), and adapter name on each device. Disconnect the router’s WAN link and confirm neither device has a separate Internet connection. Leave both devices connected to the LAN. This procedure is for a controlled test network.

Use the current arm64 or x64 image listed in [HANDOFF.md](../../HANDOFF.md#current-macos-arm64-dmg-with-explicit-adapter-selection) for each Mac. Record whether the app ran on native hardware or under Rosetta.

1. Start the daemon in local-only mode on each device. If using the DMG, copy Lanvory to Applications before testing installed behavior.
2. Open **Devices → My device → View device ID** and choose **Copy device ID**, or run `lanvory identity fingerprint`, on both devices. Exchange the fingerprints over a trusted channel. Record which fingerprint belongs to each test device.
3. In Network, choose the test network. Under **Connection settings**, confirm port 43110 and leave **Accept incoming pairing requests** checked. Select **Turn on LAN**. This approves the selected adapter and starts the listener. For the CLI path, run `lanvory network approve INTERFACE` followed by `lanvory network listener start INTERFACE LOCAL_IPV4:43110`. Confirm the local listener status and check that the peer can see both TCP and UDP entries.
4. On each device run `lanvory discover`. Resolve the remote TCP result using `lanvory discover resolve INTERFACE "SERVICE NAME"`. Confirm the matching remote IPv4 and port are returned. The same-host service may appear in the browse, but resolution must filter its local address.
5. Confirm `lanvory peer verify INTERFACE OTHER_IPV4:43110 OTHER_FINGERPRINT` succeeds on both devices. Repeat with a changed hex digit and expect a verification error. Confirm that neither run adds a trust entry.
6. Confirm mutual verification fails before pairing. On device A, start `lanvory peer pair INTERFACE B_IPV4:43110 B_FINGERPRINT`. Alternatively, in the Devices view on A, scan Nearby Devices, choose **Pair device** on B’s TCP result, verify the proposed adapter and address, and enter B’s fingerprint from step 2. For manual pairing, on B use **Copy pairing details** in My device and share the text over the trusted channel. On A use **Pair by address** and paste the text in **Device ID**. Verify the address and ID were filled correctly before sending. Open **Confirm pairing** on each device or run `lanvory pairing list` in a second terminal on each device.
   Before sending from the desktop form, confirm the address belongs to B and **Local network adapter** lists only approved, matching adapters on A. With one match, verify it is selected automatically. If the test network provides multiple matches, verify that pairing requires an explicit selection even after choosing a discovery result. Record which cases were exercised.
7. Compare the entire code on both devices over the trusted channel. Approve on A, verify that neither trust list contains the remote key, and then approve on B. The CLI alternative is `lanvory pairing approve ID CODE` using each device's request ID and the code from the other device. Confirm the initiating command returns success, both trust lists show the remote key, and `lanvory peer verify-trusted INTERFACE OTHER_IPV4:43110 OTHER_FINGERPRINT` works on each device. In a separate attempt with fresh trust state, decline on B and verify both trust lists stay empty.
8. Restart both daemons. Start both listeners again as in step 3, since runtime activation is session-scoped. Confirm trust persists and mutual verification succeeds. When retrying a pairing attempt from the same device, allow at least ten seconds between incoming requests.
9. Run the Drop, Bridge, adapter revocation at submission, and QUIC checks below while both devices are still trusted.
10. Disconnect B from the LAN while a Bridge session is active. Verify the connection ends or reports failure. Rejoin the same LAN, confirm B’s listener status, and enable it again if needed. Rescan and resolve B on A. Open a new Bridge connection with the existing trust and record the time to recover.
11. While a Bridge connection is active, revoke B's adapter approval with `lanvory network revoke INTERFACE`. Verify that B's service connection closes, both TCP and QUIC verification fail against B, and local identity and pairing records are still available. Record when A's client observes closure, which may take until the QUIC idle timeout. Approve the adapter again and restart the listener as in step 3. Confirm the existing pairing can open a new Bridge connection. Then revoke A's fingerprint on B with `lanvory peer revoke A_FINGERPRINT`. Verify that new mutual handshakes fail in both directions. One-way identity verification can still succeed.
12. In Network on B, select **Turn off LAN**. Verify the listener reports `stopped`, the selected adapter shows `approved: false` in `lanvory network`, and B's advertisement disappears from a fresh browse on A. Confirm `lanvory identity` still works on B.

Record observed times and exit results. Successful same-host or in-memory tests cannot establish the two-device result.


## Drop file check

1. With both listeners running and both devices trusted, choose B as the recipient in Sharing on A. In **Connection address**, verify that the saved address belongs to B and the adapter belongs to A. A sole matching approved adapter is selected automatically. If multiple approved adapters match, verify that **Send file** remains disabled until you choose one, even when a previous adapter was saved. Record whether the test network supported the multiple-adapter case. Choose a test file, use **Remove selected file**, and verify **Send file** becomes disabled. Drag the same file from Finder into the selection area. Verify the correct filename appears and B receives no offer until you press **Send file**. Send from A to B without an Inbox grant and confirm that B does not show an offer and A does not report success.
2. On B, open **Sharing → Allow file requests**, find A, and choose **Allow requests**. Send the file again, decline it under **Incoming requests** on B, and confirm the file does not appear in B's inbox.
3. Send again and approve on B. Confirm both devices report completion. Use Open inbox on B, then compare the SHA-256 of the received file with the original. Repeat with devices reversed to record the outgoing and incoming flow from both devices.
4. Check that the completed transfer is still listed after restarting the local daemon. Start its LAN listener again before continuing.
5. In **Transfer history**, test the **Direction** filter (`Received` and `Sent`) to verify the completed transfer appears under `Received` and is hidden under `Sent`, then return to `All directions`. Select the trash icon beside the completed entry and confirm removal. Verify the entry disappears, restart the daemon again, and confirm the entry stays absent. Check that the received file is still in the inbox and its SHA-256 still matches the original. Start the LAN listener again before continuing.
6. With a file large enough to observe while streaming, confirm that Active transfers reports increasing byte counts, average speed, and an approximate time remaining. Verify that waiting for approval does not affect the displayed average and that the speed and estimate disappear once the transfer moves into history.

## Bridge service check

Before revoking interface approval, run a test TCP service on a loopback port of device A. In Services on A, use **Share a local app** to register `smoke` under **Service name** and `127.0.0.1:PORT` under **Local app address**, then click **Share service**. In the shared service card, under **Grant access to a paired device**, select device B as **Paired device**, choose **Until revoked** or **24 hours** as **Access duration**, and click **Grant access**.

On B, open Services. Under **Connect to a service**, select device A as **Paired device**, enter `smoke` as **Shared service name**, and confirm the adapter and connection address. Under **Connection details**, leave the optional local address at `127.0.0.1:0` to let B choose the port.

Select **Connect to service** on B and note the address Lanvory displays in **Active connections** to open locally. CLI equivalents are `lanvory services share smoke LOOPBACK:PORT` and `lanvory permissions grant B_FINGERPRINT service-connect smoke` on A, and `lanvory tunnels open INTERFACE A_IPV4:43110 A_FINGERPRINT smoke` on B. Confirm a local client on B cannot reach the service before A grants `service-connect smoke` to B. Confirm the tunnel relays the expected service response. With a session open, click **Revoke access** on A and confirm the connection closes. Select **Disconnect** on B and confirm its local port closes.

## Adapter revocation at submission

Keep B's listener and grants active. On A, prepare a new file send in Sharing and leave the form open. From A's CLI, run `lanvory network revoke INTERFACE` for the adapter selected in the form. Click **Send file**. Verify that Sharing explains the lost approval, retains the selected file, and that B receives no offer. Restore adapter approval and the listener as in step 3 before proceeding.

For the reverse direction, first share a service on B and grant access to A. On A, fill in B’s details under **Connect to a service**. After revoking A's selected adapter via CLI, click **Connect to service**. Verify that Services explains the lost approval and creates no new active connection. Restore A's network setup again before continuing.

## QUIC transport check

The runtime listener enables QUIC automatically. With advertising on, verify both `tcp` and `udp` rows for the remote instance and resolve the UDP service explicitly. Run `lanvory peer verify-quic` against the remote endpoint using its previously saved pin. Repeat Drop and Bridge. Then stop the receiving daemon and run it with `lanvoryd --peer-interface INTERFACE --peer-bind LOCAL_IPV4:43110 --peer-advertise` without `--peer-quic` and verify that the same client operations complete via pinned TCP after the UDP handshake timeout. A wrong key, declined file or denied service must fail without a retry.

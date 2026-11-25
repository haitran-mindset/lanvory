# ADR-002 Explicit interface approval

Schema v2 adds an empty approval table on upgrade. Only an explicit CLI command from the authenticated OS account writes an approval. The policy pairs the interface name with a local digest of the adapter's current hardware address so reusing a name does not automatically carry consent to a different address. Neither the hardware address nor its digest is written to IPC output. This value is a local policy hint and cannot authenticate a peer.

The current approval candidate needs an up broadcast and multicast adapter with a six-byte hardware address and private or link-local IPv4. Loopback and point-to-point interfaces are excluded. A stored approval can become inactive after the adapter or address changes. Revocation remains available when the adapter is absent.

Before enabling LAN traffic, the transport must validate the specific current socket address and on-link subnet and use the approved interface for both directions. Candidate eligibility is insufficient to establish endpoint scope. The first two-host validation must cover interface transitions and an offline router.

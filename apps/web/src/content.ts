import {
  Bluetooth, Fingerprint, FolderSync, FolderUp, HardDrive, KeyRound, Laptop, LockKeyhole, Monitor, Network, Radar, ShieldCheck, SlidersHorizontal, Unplug,
} from 'lucide-react'

export const features = [
  {
    id: 'file-transfer', title: 'File Transfer', icon: FolderUp,
    description: 'Send files to paired devices with recipient approval. Track progress and review completed or failed transfers in your history.',
  },
  {
    id: 'service-bridge', title: 'Service Bridge', icon: Unplug,
    description: 'Open a service hosted on a trusted device through a local port. Grant and revoke access for each shared service.',
  },
  {
    id: 'device-discovery', title: 'Device Discovery', icon: Radar,
    description: 'Find Lanvory devices on approved network adapters, or enter a local endpoint when automatic discovery is unavailable.',
  },
  {
    id: 'secure-pairing', title: 'Secure Pairing', icon: ShieldCheck,
    description: 'Verify a device before trusting it. Confirm pairing on both devices and revoke trust whenever you need to.',
  },
  {
    id: 'folder-sync', title: 'Folder Sync', icon: FolderSync,
    description: 'Register folders for send-only, receive-only, or two-way sync. Choose which trusted devices can sync each folder.',
  },
  {
    id: 'network-explorer', title: 'Network Explorer', icon: Network,
    description: 'Inspect approved adapters, local listener status, and trusted devices. Ping a peer to verify its identity and check connection latency.',
  },
  {
    id: 'live-resource-mount', title: 'Live Resource Mount', icon: HardDrive, status: 'Prototype',
    description: 'Open a folder shared by a trusted peer as a live volume on macOS. Shared folders can be configured for read-only access.',
  },
] as const

export const copy = {
  skip: 'Skip to content',
  update: 'Lanvory is in development',
  nav: ['Why Lanvory', 'Features', 'How it works', 'Security', 'Architecture', 'Roadmap'],
  tagline: 'Local network, truly yours.',
  headline: ['Your devices,', 'connected locally.'],
  intro: 'Lanvory brings your devices together in a private workspace on your local network.',
  checks: [
    'Peer-to-peer on your LAN',
    'Works even when the internet is down',
    'No cloud or accounts',
    'Send files and sync selected folders',
    'Access services on trusted devices',
    'Encrypted connections with verified pairing',
    'Control what each device can access',
  ],
  download: 'Download for macOS',
  downloadStatus: 'Public download coming later',
  platforms: [
    {
      id: 'macos', name: 'macOS',
      description: 'Intel and Apple Silicon Macs. The minimum macOS version will be listed with the public release.',
    },
    {
      id: 'windows', name: 'Windows',
      description: 'Windows desktop support is planned.',
    },
    {
      id: 'linux', name: 'Linux',
      description: 'Linux desktop support is planned.',
    },
  ],
  why: [
    ['Local-first', 'Devices communicate directly over your local network.'],
    ['Private by default', 'You choose which devices to trust and what to share.'],
    ['Works offline', 'Use a shared local network without internet access.'],
  ],
  featureIntro: 'Discover nearby devices, share files and services, and work across your local network.',
  steps: [
    {
      demo: 'discover',
      title: 'Find nearby devices',
      description: 'Connect both devices to the same Wi-Fi or Ethernet network, enable LAN access, and look for the other device in Nearby. You can also enter its local address manually.',
      alt: 'Machine A finds Machine B in Nearby after LAN access is enabled.',
    },
    {
      demo: 'pair',
      title: 'Pair your devices',
      description: 'On the receiving device, choose the number shown on the sender from three options. Compare the verification code, then approve pairing on both devices.',
      alt: 'Machine B picks 47 from 12, 47, and 83 to match the number on Machine A, then confirms the verification code and approves pairing.',
    },
    {
      demo: 'transfer',
      title: 'Choose what to share',
      description: 'Send a file for the recipient to approve, sync a selected folder, or grant access to a specific local service.',
      alt: 'A file from Machine A waits for approval on Machine B, then transfers and is verified before it reaches the inbox.',
    },
  ],
  securityIntro: 'You approve where Lanvory connects, which devices it trusts, and what each device can access.',
  quickStart: [
    ['Set up both devices', 'Install and open Lanvory on both devices. Connect them to the same Wi-Fi or Ethernet network.'],
    ['Enable LAN access', 'Enable LAN access in Lanvory on both devices. If prompted, allow Lanvory to access the local network.'],
    ['Pair the devices', 'Open Devices and select the other device under Nearby. Choose the matching number, compare the verification code, and approve on both devices.'],
    ['Send your first file', 'Open Sharing, pick a file and a trusted recipient, then send it. On the receiving device, select Accept file and open the Inbox.'],
  ],
  faq: [
    ['Does Lanvory need internet access?', 'Once installed, Lanvory can discover devices, pair, and transfer files over a shared local network without an internet connection.'],
    ['Why can’t I see the other device?', 'Check that both devices are on the same local network and have enabled LAN access. Some guest Wi-Fi networks isolate devices from each other.'],
    ['Can I connect if automatic discovery fails?', 'Yes. In the pairing screen, enter the other device’s local address and Device ID. Both devices still need to be reachable on the same local network.'],
    ['Where do received files go?', 'After you accept a file, Lanvory verifies it and saves it to the Inbox. Open Sharing and select Open inbox to find it.'],
    ['When will Windows and Linux be supported?', 'Both are on the roadmap. Release dates for Windows and Linux have yet to be announced.'],
  ],
  roadmap: [
    {
      phase: 'In progress', title: 'macOS MVP', icon: Laptop,
      description: 'Support Intel and Apple Silicon Macs. Validate offline pairing, file transfer, and service sharing across two devices, and complete release checks.',
    },
    {
      phase: 'Next', title: 'Bluetooth Low Energy (BLE)', icon: Bluetooth,
      description: 'Use Bluetooth Low Energy to discover nearby devices running Lanvory.',
    },
    {
      phase: 'Future', title: 'Windows and Linux', icon: Monitor,
      description: 'Bring Lanvory to Windows and Linux desktops.',
    },
  ],
  back: 'Back to top',
} as const

export const securityControls = [
  {
    title: 'Approved LAN connections', icon: Network,
    description: 'Lanvory communicates through network adapters you approve and checks that peer addresses are reachable on the local link.',
  },
  {
    title: 'Verified device pairing', icon: Fingerprint,
    description: 'Nearby devices start untrusted. Compare the verification details and confirm on both devices before Lanvory saves the peer’s identity.',
  },
  {
    title: 'Encrypted peer connections', icon: LockKeyhole,
    description: 'Peer connections use TLS 1.3. Both devices verify each other’s saved identities before opening a trusted session.',
  },
  {
    title: 'Local identity keys', icon: KeyRound,
    description: 'Each device generates its own Ed25519 identity. On macOS, Lanvory protects the private key with Keychain.',
  },
  {
    title: 'Resource-level permissions', icon: SlidersHorizontal,
    description: 'A paired device starts with no resource access. Grant access to a specific inbox or service, review permission changes locally, and revoke access when needed.',
  },
  {
    title: 'Approved and verified files', icon: ShieldCheck,
    description: 'The recipient approves each incoming file offer. Lanvory verifies the file’s SHA-256 checksum before placing it in the inbox.',
  },
] as const

export const technicalArchitecture = {
  connection: [
    {
      technology: 'mDNS + DNS-SD', icon: Radar,
      description: 'Find nearby devices on approved LAN adapters.',
      link: 'docs/protocols/discovery.md',
    },
    {
      technology: 'Ed25519 + TLS exporter', icon: Fingerprint,
      description: 'Verify device identities and bind pairing to the TLS session.',
      link: 'docs/protocols/pairing.md',
    },
    {
      technology: 'QUIC + mutual TLS 1.3', icon: Network,
      description: 'Encrypt peer traffic, with TCP fallback on handshake timeout.',
      link: 'docs/protocols/quic.md',
    },
  ],
  resources: [
    {
      technology: 'Streaming SHA-256', icon: FolderUp,
      description: 'Verify each incoming file before it reaches the inbox.',
      link: 'docs/protocols/drop.md',
    },
    {
      technology: 'SHA-256 + conflict copies', icon: FolderSync,
      description: 'Detect file changes and preserve conflicting versions where possible.',
      link: 'core/internal/sync/protocol.go',
    },
    {
      technology: 'Per-peer grants + SQLite', icon: SlidersHorizontal,
      description: 'Grant access per peer and resource, with logs stored locally.',
      link: 'docs/security/permissions.md',
    },
  ],
} as const

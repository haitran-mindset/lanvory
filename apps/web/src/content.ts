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
    description: 'Find Lanvory devices on approved LAN adapters, via Bluetooth + Wi-Fi P2P, or by entering a local endpoint manually.',
  },
  {
    id: 'ble-p2p-nearby', title: 'Bluetooth + Wi-Fi P2P', icon: Bluetooth,
    description: 'Discover nearby devices over Bluetooth Low Energy and transfer directly over peer-to-peer Wi-Fi without a shared router.',
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
  nav: ['Why Lanvory', 'Features', 'How it works', 'Security', 'Architecture', 'Roadmap'],
  tagline: 'Local network, truly yours.',
  headline: ['Your devices,', 'connected locally.'],
  intro: 'Lanvory brings your devices together in a private workspace on your local network.',
  checks: [
    'Peer-to-peer on your LAN or via Bluetooth + Wi-Fi P2P',
    'Works even when the internet or router is down',
    'No cloud or accounts',
    'Send files and sync selected folders',
    'Access services on trusted devices',
    'Encrypted connections with verified pairing',
    'Control what each device can access',
  ],
  download: 'Download for macOS',
  platforms: [
    {
      id: 'macos', name: 'macOS',
      description: 'Available for Apple Silicon (arm64) and Intel (x64) Macs.',
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
      description: 'Connect both devices to the same LAN or enable Bluetooth + P2P on macOS, then look for the other device in Nearby. You can also enter its address manually.',
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
    ['Set up both devices', 'Install and open Lanvory on both devices. Connect them to the same LAN, or keep them nearby with Bluetooth and Wi-Fi turned on.'],
    ['Enable Local Network or Bluetooth + P2P', 'Turn on Local Network or Bluetooth + P2P in the Lanvory sidebar. Grant macOS network and Bluetooth permissions when prompted.'],
    ['Pair the devices', 'Open Devices and select the other device under Nearby. Choose the matching number, compare the verification code, and approve on both devices.'],
    ['Send your first file', 'Open Sharing, pick a file and a trusted recipient, then send it. On the receiving device, select Accept file and open the Inbox.'],
  ],
  faq: [
    ['macOS says Lanvory is damaged or from an unidentified developer?', 'Current builds are ad-hoc signed without Apple notarization. Drag Lanvory.app to Applications, then run "xattr -cr /Applications/Lanvory.app" in Terminal before launching it.'],
    ['Can I connect without a shared Wi-Fi router?', 'Yes. Enable Bluetooth + P2P in the sidebar to discover nearby devices over Bluetooth Low Energy and connect directly via peer-to-peer Wi-Fi.'],
    ['Does Lanvory need internet access?', 'Once installed, Lanvory can discover devices, pair, and transfer files over a shared local network or Bluetooth + P2P without an internet connection.'],
    ['Why can’t I see the other device?', 'Check that both devices have Local Network or Bluetooth + P2P enabled. Some guest Wi-Fi networks isolate devices from each other—in that case, use Bluetooth + P2P.'],
    ['Can I connect if automatic discovery fails?', 'Yes. In the pairing screen, enter the other device’s local address and Device ID. Both devices still need to be reachable on the same local network.'],
    ['Where do received files go?', 'After you accept a file, Lanvory verifies it and saves it to the Inbox. Open Sharing and select Open inbox to find it.'],
    ['When will Windows and Linux be supported?', 'Both are on the roadmap. Release dates for Windows and Linux have yet to be announced.'],
  ],
  roadmap: [
    {
      phase: 'Available', title: 'macOS Desktop & Bluetooth + P2P', icon: Laptop,
      description: 'Apple Silicon and Intel Macs with LAN discovery, Bluetooth Low Energy + Wi-Fi P2P (AWDL), verified pairing, file transfer, folder sync, and service bridge.',
    },
    {
      phase: 'In progress', title: 'Live Resource Mount & Signed Releases', icon: HardDrive,
      description: 'Expand Live Resource Mount workflows and add Apple Developer ID signing and notarization for seamless macOS installation.',
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
    title: 'Approved LAN & P2P transports', icon: Network,
    description: 'Lanvory only listens on network adapters and Bluetooth + P2P transports you explicitly enable, and verifies peer reachability before connecting.',
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
      stage: 'Discovery',
      nodes: [
        {
          technology: 'mDNS + DNS-SD', icon: Radar,
          description: 'Find nearby devices on approved LAN adapters.',
          link: 'docs/protocols/discovery.md',
        },
        {
          technology: 'BLE + Wi-Fi P2P', icon: Bluetooth,
          description: 'Discover nearby devices over BLE and connect directly via peer-to-peer Wi-Fi.',
          link: 'core/internal/nearby/nearby.go',
        },
      ],
    },
    {
      stage: 'Pairing',
      nodes: [
        {
          technology: 'Ed25519 + TLS exporter', icon: Fingerprint,
          description: 'Verify device identities and bind pairing to the TLS session.',
          link: 'docs/protocols/pairing.md',
        },
      ],
    },
    {
      stage: 'Transport',
      nodes: [
        {
          technology: 'QUIC + mutual TLS 1.3', icon: Network,
          description: 'Encrypt peer traffic, with TCP fallback on handshake timeout.',
          link: 'docs/protocols/quic.md',
        },
      ],
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

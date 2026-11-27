import {
  Bluetooth, Fingerprint, FolderSync, FolderUp, HardDrive, KeyRound, Laptop, LockKeyhole, Monitor, Network, Radar, ScreenShare, ShieldCheck, SlidersHorizontal, Unplug,
} from 'lucide-react'

export const features = [
  {
    id: 'file-transfer', title: 'File Transfer', icon: FolderUp,
    description: 'Send files to paired devices with recipient approval. Track progress and review completed or failed transfers in your history.',
    highlights: ['Recipient approves every incoming file', 'Automatic integrity check before saving', 'Cancel anytime & keep local transfer history'],
    flow: ['Pick file', 'Approve on receiver', 'Saved to Inbox'],
  },
  {
    id: 'screen-sharing', title: 'Screen Sharing', icon: ScreenShare, status: 'macOS',
    description: 'Show a window or display to one paired Mac over your local network, without an internet relay.',
    highlights: ['Choose a window or display from local previews', 'The viewer accepts each invitation', 'Either device can end the session'],
    flow: ['Choose a source', 'Invite a paired Mac', 'Accept & view'],
    guide: 'docs/protocols/screen-sharing.md',
  },
  {
    id: 'live-resource-mount', title: 'Live Resource Mount', icon: HardDrive, status: 'Prototype',
    description: 'Browse shared folders and stream large videos, audio, or documents on demand—without copying the entire folder.',
    highlights: ['Stream videos & files instantly on demand', 'Choose view-only or editable access per device', 'Optional Finder integration on macOS'],
    flow: ['Shared folder', 'Stream on demand', 'Browse / Preview'],
  },
  {
    id: 'folder-sync', title: 'Folder Sync', icon: FolderSync,
    description: 'Register folders for send-only, receive-only, or two-way sync. Choose which trusted devices can sync each folder.',
    highlights: ['Send-only, receive-only, or two-way modes', 'Preserves conflict copies instead of overwriting', 'Grant & revoke sync per device anytime'],
    flow: ['Selected folder', 'Detect changes', 'Synced safely'],
  },
  {
    id: 'service-bridge', title: 'Service Bridge', icon: Unplug,
    description: 'Open a service hosted on a trusted device through a private local port. Grant and revoke access for each shared service.',
    highlights: ['Share local web apps or DBs privately', 'Never exposes ports to the public network', 'Timed or instant-revoke access per peer'],
    flow: ['Local app :8080', 'Encrypted tunnel', 'Peer :8080'],
  },
  {
    id: 'ble-p2p-nearby', title: 'Bluetooth + Wi-Fi P2P', icon: Bluetooth,
    description: 'Discover nearby devices over Bluetooth Low Energy and transfer directly over peer-to-peer Wi-Fi without a shared router.',
    highlights: ['Works even without a Wi-Fi router', 'Bypasses guest Wi-Fi client isolation', 'Toggle Discoverable on or off anytime'],
    flow: ['Bluetooth scan', 'Direct Wi-Fi P2P', 'Paired & connected'],
  },
  {
    id: 'device-discovery', title: 'Device Discovery', icon: Radar,
    description: 'Find Lanvory devices on approved LAN adapters, via Bluetooth + Wi-Fi P2P, or by entering a local address manually.',
    highlights: ['Scans only adapters you explicitly approve', 'Manual IP fallback when mDNS is blocked', 'Discovered devices stay untrusted until paired'],
    flow: ['Approved adapter', 'Nearby scan', 'Ready to pair'],
  },
  {
    id: 'secure-pairing', title: 'Secure Pairing', icon: ShieldCheck,
    description: 'Verify a device before trusting it. Confirm matching codes on both devices and revoke trust whenever you need to.',
    highlights: ['Both devices confirm matching codes', 'Unique device identity stored locally', 'One-click trust revocation'],
    flow: ['Match number', 'Confirm on both', 'Trusted peer'],
  },
  {
    id: 'network-explorer', title: 'Network Explorer', icon: Network,
    description: 'Inspect approved adapters, local listener status, and trusted devices. Ping a peer to verify its identity and check latency.',
    highlights: ['Live adapter & listener status', 'Real round-trip latency check (ping)', 'No fake metrics or background scanning'],
    flow: ['Select adapter', 'Ping trusted peer', 'Live RTT'],
  },
] as const

export const copy = {
  skip: 'Skip to content',
  nav: ['Why Lanvory', 'Features', 'Compare', 'How it works', 'Security', 'Architecture', 'Roadmap'],
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
    ['No router? Still connected.', 'Use your local Wi-Fi or Ethernet network, or connect nearby devices directly via Bluetooth + Wi-Fi P2P when there’s no router or public Wi-Fi blocks sharing.'],
    ['Watch & open without waiting.', 'Browse shared folders and stream large videos or files right away—without copying gigabytes onto your drive.'],
    ['Share local apps, safely.', 'Let a trusted device open an app running on your computer without exposing it to the internet or the rest of the network.'],
  ],
  featureIntro: 'Discover nearby devices, share files, screens, and services, and work across your local network.',
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
    ['How do I share my screen?', 'In Lanvory 0.1.6 or later, pair both Macs on the same LAN and open Screen Sharing on both. The sender chooses a source, previews it, and invites the viewer. The viewer selects Accept.'],
    ['Does Screen Sharing work over Bluetooth + Wi-Fi P2P?', 'Screen Sharing currently uses a shared LAN. Screen streaming over direct Wi-Fi is a separate roadmap milestone.'],
    ['Where do received files go?', 'After you accept a file, Lanvory verifies it and saves it to the Inbox. Open Sharing and select Open inbox to find it.'],
    ['When will Windows and Linux be supported?', 'Both are on the roadmap. Release dates for Windows and Linux have yet to be announced.'],
  ],
  roadmap: [
    {
      phase: 'Available', title: 'macOS desktop', icon: Laptop,
      description: 'Apple Silicon and Intel builds with Bluetooth + Wi-Fi P2P, file sharing, Folder Sync, Live Resource Mount, and update notices.',
    },
    {
      phase: 'Current focus', title: 'Two-device validation', icon: Network,
      description: 'Verify offline discovery, pairing, file transfer, sync, live mounts, and Screen Sharing across two physical devices.',
    },
    {
      phase: 'Next', title: 'Signed macOS releases', icon: ShieldCheck,
      description: 'Add Apple Developer ID signing and notarization to simplify installation and prepare for in-app updates.',
    },
    {
      phase: 'Next', title: 'Smoother Screen Sharing', icon: ScreenShare,
      description: 'Measure latency on real LANs, then improve text clarity and motion with adaptive quality and a lower-overhead media path.',
    },
    {
      phase: 'Future', title: 'Screen Sharing over direct Wi-Fi', icon: Bluetooth,
      description: 'Validate screen streaming between nearby Macs without a shared router and assess optional system audio with explicit consent.',
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
    description: 'Each device generates its own Ed25519 identity and stores the seed in an owner-only local file.',
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
          link: 'docs/protocols/nearby.md',
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
      link: 'docs/protocols/sync.md',
    },
    {
      technology: 'Adaptive JPEG + scoped mTLS', icon: ScreenShare,
      description: 'Stream bounded screen frames over authenticated LAN TCP after the viewer accepts.',
      link: 'docs/protocols/screen-sharing.md',
    },
    {
      technology: 'Per-peer grants + SQLite', icon: SlidersHorizontal,
      description: 'Grant access per peer and resource, with logs stored locally.',
      link: 'docs/security/permissions.md',
    },
  ],
} as const

export const comparison = {
  title: 'One workspace. Zero compromises.',
  intro: 'Stop juggling four separate tools, cloud logins, and exposed ports. Lanvory unifies your entire local device workflow.',
  note: 'Note: Comparison details are for reference only and summarize typical workflows; capabilities of third-party tools may vary by version and platform.',
  stack: [
    { id: 'localsend', replaces: 'LocalSend / PairDrop', role: 'File Drop', capability: 'Drop, sync, live mount & tunnels' },
    { id: 'syncthing', replaces: 'Syncthing', role: 'Folder Sync', capability: 'Stream & browse without copying' },
    { id: 'tailscale', replaces: 'Tailscale / ZeroTier', role: 'Mesh VPN', capability: 'Zero cloud, zero accounts' },
    { id: 'airdrop', replaces: 'AirDrop', role: 'Apple Handoff', capability: 'Continuous local workspace' },
  ],
  metrics: [
    { value: '4 → 1', label: 'Apps replaced' },
    { value: '0', label: 'Cloud accounts needed' },
    { value: 'LAN + P2P', label: 'Works even without a router' },
  ],
  versus: [
    {
      id: 'localsend',
      name: 'LocalSend / PairDrop',
      summary: 'Great for quick drops, stops there.',
      pairs: [
        ['One-off file transfer only', 'Send files, sync folders, stream media & share local apps'],
        ['Needs shared Wi-Fi router (fails on guest Wi-Fi)', 'Connects nearby devices directly when Wi-Fi blocks peers'],
        ['No saved permissions or access history', 'Saved device trust with timed access you can revoke anytime'],
      ],
    },
    {
      id: 'syncthing',
      name: 'Syncthing',
      summary: 'Strong folder sync, heavy for daily workflows.',
      pairs: [
        ['Must copy entire folders before opening files', 'Stream videos & open remote files right away without copying'],
        ['Browser-based setup that feels complex', 'Clean desktop app with one-click device pairing'],
        ['No quick file offers or local app sharing', 'Built-in file drop and private local app sharing'],
      ],
    },
    {
      id: 'tailscale',
      name: 'Tailscale / ZeroTier',
      summary: 'Cloud-managed VPN, built for remote access.',
      pairs: [
        ['Requires accounts & cloud servers to coordinate', 'Zero cloud, zero accounts—works completely offline'],
        ['Exposes your device on a virtual network', 'Shares only the exact app or folder you approve'],
        ['Needs internet to manage access rules', 'Full control and access history stored right on your device'],
      ],
    },
    {
      id: 'airdrop',
      name: 'AirDrop',
      summary: 'Fast Apple-only handoff, no workspace continuity.',
      pairs: [
        ['One-shot transfers only; no ongoing sync', 'Continuous workspace: sync, live folders & local apps'],
        ['No live folder browsing or media streaming', 'Browse and stream large folders without filling your disk'],
        ['Apple-only ecosystem lock-in', 'Designed for cross-platform local workflows'],
      ],
    },
  ],
} as const

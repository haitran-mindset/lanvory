import { Bluetooth } from 'lucide-react';
import { bluetoothSignalLabel } from './nearby-signal';

export function NearbyConnectionLabel({ peer }: {
  peer: { p2pReady: boolean; transport: string; rssi: number };
}) {
  return (
    <small className="nearby-connection-label">
      <Bluetooth size={15} aria-hidden="true" />
      {[peer.p2pReady ? 'Wi-Fi P2P ready' : 'Bluetooth', bluetoothSignalLabel(peer)]
        .filter(Boolean).join(' · ')}
    </small>
  );
}

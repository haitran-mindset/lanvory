export function bluetoothSignalLabel({ transport, rssi }: { transport: string; rssi: number }) {
  // AWDL-only records carry a placeholder RSSI, not a Bluetooth measurement.
  if ((transport !== 'ble' && transport !== 'ble+awdl') || rssi === 127) return undefined;
  if (rssi >= -60) return 'Strong Bluetooth signal';
  if (rssi >= -78) return 'Good Bluetooth signal';
  return 'Weak Bluetooth signal';
}

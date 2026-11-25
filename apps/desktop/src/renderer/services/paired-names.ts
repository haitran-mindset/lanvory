import { z } from 'zod';

const namesSchema = z.record(z.string().regex(/^[0-9a-f]{64}$/i), z.string().max(64));

export function readPairedNames(ownerId: string): Record<string, string> {
  try {
    const value = localStorage.getItem(`lanvory.paired-names.${ownerId}`);
    return namesSchema.safeParse(JSON.parse(value ?? '{}')).data ?? {};
  } catch {
    return {};
  }
}

export function writePairedNames(ownerId: string, names: Record<string, string>) {
  localStorage.setItem(`lanvory.paired-names.${ownerId}`, JSON.stringify(names));
}

export function pairedDeviceName(fingerprint: string, names: Record<string, string>) {
  return names[fingerprint] || `DEVICE-${fingerprint.slice(0, 5).toUpperCase()}`;
}

import { z } from 'zod';

export const identitySchema = z.object({
  id: z.string(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().min(1),
  os: z.string(),
  protocolVersion: z.literal(1),
  daemonVersion: z.string().min(1).max(128).optional(),
});

const responseSchema = z.object({
  device: identitySchema.nullable(),
  startupFailed: z.boolean().optional(),
  startupPending: z.boolean().optional(),
  startupSlow: z.boolean().optional(),
});
export type IdentityResponse = z.infer<typeof responseSchema>;

export async function readIdentity(retry = false): Promise<IdentityResponse> {
  const result = await window.lanvory.identity(retry).catch(() => null);
  const parsed = responseSchema.safeParse(result);
  return parsed.success ? parsed.data : { device: null };
}

export function daemonNotice(response?: IdentityResponse) {
  if (!response) return 'Reading the local device identity…';
  if (response.startupFailed) return 'Lanvory could not start the local daemon. Check the installation and login Keychain access.';
  if (response.startupSlow) return 'The daemon is taking longer than expected to start. On macOS, check for a Keychain access prompt.';
  return 'Waiting for the local daemon.';
}


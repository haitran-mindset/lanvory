import { z } from 'zod';

const interfacesSchema = z.array(z.object({
  index: z.number().int().positive(),
  name: z.string().min(1),
  up: z.boolean(),
  loopback: z.boolean(),
  multicast: z.boolean(),
  addresses: z.array(z.string()),
  eligible: z.boolean().optional(),
  approved: z.boolean().optional(),
}));

export type Interfaces = z.infer<typeof interfacesSchema>;

export async function readInterfaces() {
  const value = await window.lanvory.interfaces().catch(() => null);
  const parsed = interfacesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

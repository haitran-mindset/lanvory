import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { readInterfaces } from '../services/network-interfaces';
import { SelectField } from './ui/select';

const scopeSchema = z.object({ allowed: z.boolean() });

export function endpointAddress(endpoint: string) {
  const match = /^([0-9.]+):([0-9]{1,5})$/.exec(endpoint.trim());
  if (!match || !z.ipv4().safeParse(match[1]).success || Number(match[2]) < 1 || Number(match[2]) > 65535) return;
  return match[1];
}

async function checkAdapter(adapter: string, address: string) {
  const result = scopeSchema.safeParse(await window.lanvory.checkScope(adapter, address).catch(() => null));
  return result.success ? result.data.allowed : null;
}

export async function connectionError(adapter: string, endpoint: string) {
  const address = endpointAddress(endpoint);
  if (!address) return 'Enter a valid IPv4 address and port for the other device.';
  if (!adapter) return 'Choose an approved local adapter that can reach this address.';
  const allowed = await checkAdapter(adapter, address);
  if (allowed === null) return 'Unable to verify the local adapter. Try again.';
  if (!allowed) return 'The local adapter is no longer approved or cannot reach this address. Check Network.';
}

export function PeerConnectionFields({ suggestedEndpoint = '', endpoints = [], endpointLabel = 'Device address', adapterLabel = 'Local network adapter', disabled, onReady }: {
  suggestedEndpoint?: string;
  endpoints?: string[];
  endpointLabel?: string;
  adapterLabel?: string;
  disabled?: boolean;
  onReady?(ready: boolean): void;
}) {
  const [draft, setDraft] = useState<{ suggestion: string; value: string }>();
  const endpoint = draft?.suggestion === suggestedEndpoint ? draft.value : suggestedEndpoint;
  const address = endpointAddress(endpoint);
  const listId = useId();
  const [result, setResult] = useState<{ address: string; options: string[] | null }>();
  const [choice, setChoice] = useState('');
  const options = result?.address === address ? result?.options : undefined;
  const adapter = options?.includes(choice) ? choice
    : options?.length === 1 ? options[0] : '';

  useEffect(() => {
    if (!address) return;
    let active = true;
    const timer = setTimeout(async () => {
      const interfaces = await readInterfaces();
      if (!active) return;
      const candidates = interfaces?.filter(({ eligible, approved }) => eligible && approved) ?? [];
      const checks = await Promise.all(candidates.map(({ name }) => checkAdapter(name, address)));
      if (!active) return;
      setResult({ address, options: !interfaces || checks.includes(null)
        ? null : candidates.filter((_, index) => checks[index]).map(({ name }) => name) });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [address]);

  useEffect(() => { onReady?.(Boolean(adapter)); }, [adapter, onReady]);

  return (
    <>
      <label>{endpointLabel}<input name="endpoint" required maxLength={21} value={endpoint} disabled={disabled}
        list={endpoints.length > 1 ? listId : undefined} placeholder="IPv4 address:port"
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft({ suggestion: suggestedEndpoint, value });
          if (endpointAddress(value) !== address) {
            setResult(undefined);
            setChoice('');
          }
        }} /></label>
      {endpoints.length > 1 && <datalist id={listId}>{endpoints.map((value) => <option key={value} value={value} />)}</datalist>}
      {!endpoint.trim() && <p>Copy the LAN address from the other device’s Network tab.</p>}
      {endpoint.trim() && !address && <p role="status">Enter a valid IPv4 address and port.</p>}
      {address && options === undefined && <p role="status">Checking approved local adapters…</p>}
      {options === null && <p role="status">Unable to verify local adapters. Check Network and reopen the form.</p>}
      {options?.length === 0 && <p role="status">No approved local adapter can reach this address. Check Network and the device address.</p>}
      {!!options?.length && <SelectField label={adapterLabel} name="adapter" required
        placeholder="Choose a local adapter" value={adapter} disabled={disabled}
        options={options.map((name) => ({ value: name, label: name }))} onValueChange={setChoice} />}
    </>
  );
}

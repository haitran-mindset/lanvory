import { useRef, useState } from 'react';
import { Copy, Monitor, X } from 'lucide-react';
import { daemonNotice, type IdentityResponse } from '../../services/identity';

export function MyDevice({ response, retrying, onRetry, incomingPairingEnabled }: {
  response?: IdentityResponse;
  retrying: boolean;
  incomingPairingEnabled: boolean;
  onRetry(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const device = response?.device;
  const unavailable = response && !device && !response.startupPending && !response.startupSlow;

  async function copy(details = false) {
    if (!device) return;
    const copied = await (details ? window.lanvory.copyPairingDetails(device.fingerprint)
      : window.lanvory.copyFingerprint(device.fingerprint)).catch(() => false);
    setCopyMessage(details
      ? copied ? 'Pairing details copied.' : 'Turn on LAN and allow incoming pairing to copy pairing details.'
      : copied ? 'Device ID copied.' : 'Unable to copy the device ID.');
  }

  return (
    <>
      <div className="my-device-card">
        <span className="panel-icon"><Monitor size={21} aria-hidden="true" /></span>
        <div className="my-device-card-label"><small>My device</small><strong>{device?.name ?? (unavailable ? 'Connection unavailable' : 'Connecting…')}</strong></div>
        <button type="button" className="refresh" aria-haspopup="dialog" aria-controls="identity-details" onClick={() => {
          setCopyMessage('');
          dialog.current?.showModal();
        }}>{device ? 'View device ID' : 'View status'}</button>
        {unavailable && (
          <button type="button" className="primary" disabled={retrying} onClick={onRetry}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
      <dialog ref={dialog} id="identity-details" className="pairing-dialog my-device-dialog" aria-labelledby="my-device-title">
        <div className="pairing-card-heading">
          <h3 id="my-device-title">My device</h3>
          <button type="button" className="pairing-dismiss" aria-label="Close My device" onClick={() => dialog.current?.close()}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {device ? (
          <>
            <div className="my-device-name"><span className="panel-icon"><Monitor size={20} aria-hidden="true" /></span>
              <div><strong>{device.name}</strong><small>{device.os === 'darwin' ? 'macOS' : device.os}</small></div>
            </div>
            <h4>Device ID</h4>
            <code className="pairing-code">{device.fingerprint}</code>
            <p>Share this ID through a trusted channel when someone wants to pair with this device.</p>
            <div className="pairing-actions">
              <button type="button" className="primary" onClick={() => void copy()}><Copy size={16} aria-hidden="true" /> Copy device ID</button>
              {incomingPairingEnabled && <button type="button" className="refresh" onClick={() => void copy(true)}>Copy pairing details</button>}
              {copyMessage && <p role="status">{copyMessage}</p>}
            </div>
          </>
        ) : (
          <>
            <p role="status">{daemonNotice(response)}</p>
            <button type="button" className="refresh" disabled={retrying} onClick={onRetry}>Retry</button>
          </>
        )}
      </dialog>
    </>
  );
}

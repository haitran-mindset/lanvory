const { existsSync } = require('node:fs');
const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

const statusLabels = {
  checking: 'Checking daemon…',
  starting: 'Daemon starting…',
  slow: 'Waiting for daemon startup',
  online: 'Daemon online',
  listening: 'LAN active',
  unavailable: 'Daemon unavailable',
};

function createMenuBar({ open, navigate, retry, quit }) {
  const trayPath = path.join(__dirname, '../../assets/trayTemplate.png');
  let icon = existsSync(trayPath) ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();
  if (icon.isEmpty()) {
    const fallback = nativeImage.createFromNamedImage('NSNetwork');
    if (fallback.isEmpty()) return null;
    icon = fallback.resize({ width: 16, height: 16 });
  }
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  let shown;
  let details = {};
  const rebuild = () => {
    const status = shown ?? 'checking';
    const label = statusLabels[status] ?? 'Lanvory ready';
    tray.setToolTip(`Lanvory — ${label}`);
    const infoItems = [];
    if (details.endpoint) infoItems.push({ label: `Local IP: ${details.endpoint}`, enabled: false });
    if (typeof details.trusted === 'number') infoItems.push({ label: `Trusted devices: ${details.trusted}`, enabled: false });
    if (typeof details.transfers === 'number' && details.transfers > 0) {
      infoItems.push({ label: `Active transfers: ${details.transfers}`, enabled: false });
    }
    const navAvailable = status === 'online' || status === 'listening';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Lanvory', click: open },
      { type: 'separator' },
      { label, enabled: false },
      ...infoItems,
      { label: 'Retry daemon connection', enabled: status === 'unavailable', click: retry },
      ...(navigate ? [
        { type: 'separator' },
        { label: 'Send Files…', enabled: navAvailable, click: () => navigate('Sharing') },
        { label: 'Manage Services', enabled: navAvailable, click: () => navigate('Services') },
        { label: 'Network', click: () => navigate('Network') },
        { label: 'Settings', click: () => navigate('Settings') },
      ] : []),
      { type: 'separator' },
      { label: 'Quit Lanvory', click: quit },
    ]));
  };
  const setStatus = (status) => {
    if (shown === status) return;
    shown = status;
    rebuild();
  };
  const setDetails = (next = {}) => {
    if (next.endpoint === details.endpoint && next.trusted === details.trusted && next.transfers === details.transfers) {
      return;
    }
    details = next;
    rebuild();
  };
  setStatus('checking');
  return { setStatus, setDetails, destroy: () => tray.destroy() };
}

function createPairingAlerts(show) {
  const notified = new Map();
  return (requests, now = Date.now()) => {
    for (const [id, deadline] of notified) {
      if (deadline <= now) notified.delete(id);
    }
    if (!Array.isArray(requests)) return;
    let hasNewRequest = false;
    for (const request of requests) {
      if (request?.direction !== 'incoming' || !/^[a-f0-9]{32}$/.test(request.id)
          || notified.has(request.id)) continue;
      const deadline = Date.parse(request.expiresAt);
      if (!(deadline > now)) continue;
      notified.set(request.id, deadline);
      hasNewRequest = true;
    }
    if (hasNewRequest) show();
  };
}

// Only a child launched by this Electron process can be stopped here.
function stopOwnedDaemon(child, graceMs = 6000) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      child.removeListener('exit', done);
      child.removeListener('error', done);
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      done();
    }, graceMs);
    try {
      if (!child.kill('SIGTERM')) done();
    } catch {
      done();
    }
  });
}

module.exports = { createMenuBar, createPairingAlerts, stopOwnedDaemon };

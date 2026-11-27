const { existsSync } = require('node:fs');
const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

function networkDot(red, green, blue) {
  const size = 14;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const alpha = Math.max(0, Math.min(1, size / 2 - distance));
      pixels[offset] = Math.round(blue * alpha);
      pixels[offset + 1] = Math.round(green * alpha);
      pixels[offset + 2] = Math.round(red * alpha);
      pixels[offset + 3] = Math.round(255 * alpha);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
}

function createMenuBar({ open, navigate, retry, quit, stopScreenSharing }) {
  const trayPath = path.join(__dirname, '../../assets/trayTemplate.png');
  let icon = existsSync(trayPath) ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();
  if (icon.isEmpty()) {
    const fallback = nativeImage.createFromNamedImage('NSNetwork');
    if (fallback.isEmpty()) return null;
    icon = fallback.resize({ width: 16, height: 16 });
  }
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const activeDot = networkDot(53, 209, 131);
  const inactiveDot = networkDot(133, 145, 139);
  let shown;
  let screenSharing = false;
  let localNetwork = false;
  const rebuild = () => {
    const navAvailable = shown === 'online';
    tray.setToolTip('Lanvory');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Lanvory', click: open },
      ...(shown === 'unavailable' ? [{ label: 'Reconnect Lanvory', click: retry }] : []),
      ...(screenSharing ? [{ label: 'Stop Screen Sharing', click: stopScreenSharing }] : []),
      ...(navigate ? [
        { type: 'separator' },
        { label: 'Send Files…', enabled: navAvailable, click: () => navigate('Sharing') },
        { label: 'Manage Services', enabled: navAvailable, click: () => navigate('Services') },
        { label: 'Local Network', icon: navAvailable && localNetwork ? activeDot : inactiveDot, click: () => navigate('Network') },
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
  const setScreenSharing = (active) => {
    if (screenSharing === active) return;
    screenSharing = active;
    rebuild();
  };
  const setLocalNetwork = (active) => {
    if (localNetwork === active) return;
    localNetwork = active;
    rebuild();
  };
  setStatus('checking');
  return { setStatus, setScreenSharing, setLocalNetwork, destroy: () => tray.destroy() };
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

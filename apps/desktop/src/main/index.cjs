const { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const { existsSync, lstatSync, readdirSync, writeFileSync, rmSync } = require('node:fs');
const { promisify } = require('node:util');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createMenuBar, createPairingAlerts, stopOwnedDaemon } = require('./native-lifecycle.cjs');

const exec = promisify(execFile);
const bundle = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../../../bin');
const index = path.join(__dirname, '../../dist/index.html');
let window;
let daemon;
let stopping = false;
let quitWait;
let menuBar;
let backgroundCheck;
let ready = false;
let identityRequest;
let interfacesRequest;
let discoveryRequest;
let trustRequest;
let activePair;
let pairingSnapshot;
let selectedFiles = [];
let filePickerOpen = false;
let activeSend;
let fileSnapshot;
let serviceSnapshot;
let nextStart = 0;
let startupFailed = false;
let daemonStartedAt;
let recoveryTimer;
const slowStartupMs = 8000;

function permissionArgs(action, fingerprint, capability, resource, duration = 'until-revoked') {
  if (!['until-revoked', 'hour', 'day'].includes(duration) || (action !== 'grant' && duration !== 'until-revoked')) {
    return null;
  }
  const args = ['permissions', action, fingerprint, capability, resource];
  if (duration !== 'until-revoked') {
    const hours = duration === 'hour' ? 1 : 24;
    args.push(new Date(Date.now() + hours * 3600000).toISOString());
  }
  return args;
}

function readIdentity() {
  identityRequest ??= exec(path.join(bundle, 'lanvory'), ['identity'], {
    timeout: 4000,
    maxBuffer: 4096,
  }).then(({ stdout }) => JSON.parse(stdout)).finally(() => {
    identityRequest = undefined;
  });
  return identityRequest;
}

async function daemonStatus(retry = false) {
  const observedDaemon = daemon;
  try {
    const device = await readIdentity();
    if (daemon === observedDaemon) daemonStartedAt = undefined;
    if (!stopping && menuBar) {
      const [listener, trusted, transfers] = await Promise.all([
        readListener().catch(() => null),
        exec(path.join(bundle, 'lanvory'), ['peer', 'trusted'], { timeout: 2000, maxBuffer: 65536 })
          .then(({ stdout }) => JSON.parse(stdout).length).catch(() => undefined),
        exec(path.join(bundle, 'lanvory'), ['files', 'transfers'], { timeout: 2000, maxBuffer: 65536 })
          .then(({ stdout }) => JSON.parse(stdout).transfers?.filter((t) => t.state === 'streaming' || t.state === 'waiting').length).catch(() => undefined),
      ]);
      if (!stopping) {
        menuBar.setStatus(listener?.state === 'listening' ? 'listening' : 'online');
        menuBar.setDetails({ endpoint: listener?.state === 'listening' ? listener.endpoint : undefined, trusted, transfers });
      }
    }
    return { device };
  } catch {
    if (retry) startDaemon();
    const startupPending = daemonStartedAt !== undefined;
    const startupSlow = startupPending && performance.now() - daemonStartedAt >= slowStartupMs;
    if (!stopping) menuBar?.setStatus(daemon ? (startupSlow ? 'slow' : 'starting') : 'unavailable');
    return { device: null, startupFailed, startupPending, startupSlow };
  }
}

function readInterfaces() {
  interfacesRequest ??= exec(path.join(bundle, 'lanvory'), ['network'], {
    timeout: 4000,
    maxBuffer: 65536,
  }).then(({ stdout }) => JSON.parse(stdout)).finally(() => {
    interfacesRequest = undefined;
  });
  return interfacesRequest;
}

async function readListener() {
  const { stdout } = await exec(path.join(bundle, 'lanvory'), ['network', 'listener'], { timeout: 4000, maxBuffer: 4096 });
  return JSON.parse(stdout);
}

function assertTrustedFrame(event) {
  const contents = window?.webContents;
  if (!contents || event.sender !== contents || !event.senderFrame
      || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== pathToFileURL(index).href) {
    throw new Error('Unauthorized desktop IPC caller');
  }
}

function startDaemon() {
  if (daemon || stopping || Date.now() < nextStart) return;
  nextStart = Date.now() + 5000;
  startupFailed = false;
  const child = spawn(path.join(bundle, 'lanvoryd'), [], { stdio: 'ignore' });
  daemon = child;
  daemonStartedAt = performance.now();
  function stopped() {
    if (daemon !== child) return;
    const wasReady = daemonStartedAt === undefined;
    daemon = undefined;
    daemonStartedAt = undefined;
    startupFailed = true;
    if (stopping) return;
    menuBar?.setStatus('unavailable');
    if (wasReady) {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        void daemonStatus(true);
      }, Math.max(0, nextStart - Date.now()));
    }
  }
  child.once('error', stopped);
  child.once('exit', stopped);
}

function readPairingRequests() {
  pairingSnapshot ??= exec(path.join(bundle, 'lanvory'), ['pairing', 'list'], { timeout: 4000, maxBuffer: 16384 })
    .then(({ stdout }) => JSON.parse(stdout)).catch(() => null).finally(() => { pairingSnapshot = undefined; });
  return pairingSnapshot;
}

let pairingNotification;
let notifiedOffers = new Set();
const alertPairing = createPairingAlerts(() => {
  pairingNotification?.close();
  const notice = new Notification({
    title: 'Lanvory pairing request',
    body: 'Open Lanvory to review the request.',
  });
  pairingNotification = notice;
  const release = () => {
    if (pairingNotification === notice) pairingNotification = undefined;
  };
  notice.once('click', () => { release(); openWindow(); });
  notice.once('close', release);
  notice.once('failed', release);
  notice.show();
});

function loginItemState() {
  const { status, openAtLogin } = app.getLoginItemSettings();
  if (status === 'requires-approval') return 'requires-approval';
  if (status === 'not-found') return 'not-found';
  return openAtLogin || status === 'enabled' ? 'enabled' : 'disabled';
}

function profileFlag(name) {
  return path.join(app.getPath('userData'), name);
}

function setProfileFlag(name, enabled) {
  const filename = profileFlag(name);
  try {
    if (enabled) {
      writeFileSync(filename, '', { flag: 'wx', mode: 0o600 });
    } else {
      rmSync(filename, { force: true });
    }
    return true;
  } catch (error) {
    return enabled && error.code === 'EEXIST';
  }
}

function pairingAlertsEnabled() {
  return Notification.isSupported() && !existsSync(profileFlag('mute-pairing-notifications'));
}

function createWindow(show = true) {
  const devIcon = path.join(__dirname, '../../assets/icon.png');
  const hasDevIcon = !app.isPackaged && existsSync(devIcon);
  if (process.platform === 'darwin' && hasDevIcon) {
    app.dock?.setIcon(devIcon);
  }
  window = new BrowserWindow({
    show,
    width: 1400,
    height: 840,
    minWidth: 610,
    minHeight: 540,
    ...(hasDevIcon ? { icon: devIcon } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#101314',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', (event) => {
    if (process.platform === 'darwin' && menuBar && !stopping) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => { window = undefined; selectedFiles = []; activeSend?.abort(); });
  return window.loadFile(index);
}

function failStartup() {
  process.exitCode = 1;
  app.quit();
}

function openWindow() {
  if (!ready || stopping) return;
  if (!window) {
    createWindow().catch(failStartup);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openWindow);
  app.on('activate', openWindow);
  app.whenReady().then(async () => {
    ipcMain.handle('lanvory:identity', async (event, retry = false) => {
      assertTrustedFrame(event);
      if (typeof retry !== 'boolean') throw new Error('Invalid identity request');
      return daemonStatus(retry);
    });
    ipcMain.handle('lanvory:copy-fingerprint', async (event, expected) => {
      assertTrustedFrame(event);
      if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
      try {
        const { fingerprint } = await readIdentity();
        if (fingerprint !== expected) return false;
        clipboard.writeText(fingerprint);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('lanvory:copy-pairing-details', async (event, expected) => {
      assertTrustedFrame(event);
      if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
      try {
        const [{ fingerprint }, listener] = await Promise.all([readIdentity(), readListener()]);
        if (fingerprint !== expected || listener?.state !== 'listening' || listener.pairing !== true ||
          typeof listener.endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(listener.endpoint)) return false;
        clipboard.writeText(`Lanvory pairing\nAddress: ${listener.endpoint}\nDevice ID: ${fingerprint}`);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('lanvory:login-item', (event) => {
      assertTrustedFrame(event);
      return process.platform === 'darwin' && app.isPackaged ? loginItemState() : null;
    });
    ipcMain.handle('lanvory:set-login-item', (event, enabled) => {
      assertTrustedFrame(event);
      if (process.platform !== 'darwin' || !app.isPackaged || typeof enabled !== 'boolean') return null;
      app.setLoginItemSettings({ openAtLogin: enabled });
      return loginItemState();
    });
    ipcMain.handle('lanvory:start-minimized', (event) => {
      assertTrustedFrame(event);
      return process.platform === 'darwin' ? existsSync(profileFlag('start-minimized')) : null;
    });
    ipcMain.handle('lanvory:set-start-minimized', (event, enabled) => {
      assertTrustedFrame(event);
      if (process.platform !== 'darwin' || typeof enabled !== 'boolean') return false;
      return setProfileFlag('start-minimized', enabled);
    });
    ipcMain.handle('lanvory:pairing-alerts', (event) => {
      assertTrustedFrame(event);
      return menuBar && Notification.isSupported() ? pairingAlertsEnabled() : null;
    });
    ipcMain.handle('lanvory:set-pairing-alerts', (event, enabled) => {
      assertTrustedFrame(event);
      if (!menuBar || !Notification.isSupported() || typeof enabled !== 'boolean') return false;
      const saved = setProfileFlag('mute-pairing-notifications', !enabled);
      if (saved && !enabled) pairingNotification?.close();
      return saved;
    });
    ipcMain.handle('lanvory:rename-device', async (event, name) => {
      assertTrustedFrame(event);
      if (typeof name !== 'string' || Buffer.byteLength(name) > 63 || !name.trim()
        || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['identity', 'rename', name], {
          timeout: 4000, maxBuffer: 4096,
        });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:interfaces', async (event) => {
      assertTrustedFrame(event);
      try { return await readInterfaces(); } catch { return null; }
    });
    ipcMain.handle('lanvory:listener-status', async (event) => {
      assertTrustedFrame(event);
      try {
        return await readListener();
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:copy-lan-address', async (event, expected) => {
      assertTrustedFrame(event);
      if (typeof expected !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(expected)) return false;
      try {
        const listener = await readListener();
        if (listener?.state !== 'listening' || listener.endpoint !== expected) return false;
        clipboard.writeText(listener.endpoint);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('lanvory:copy-network-report', async (event) => {
      assertTrustedFrame(event);
      const [identity, interfaces, listener] = await Promise.all([
        readIdentity().catch(() => null),
        readInterfaces().catch(() => null),
        readListener().catch(() => null),
      ]);
      const lan = ['local-only', 'stopped', 'listening'].includes(listener?.state) ? listener.state : 'unavailable';
      const build = identity?.daemonVersion;
      const adapters = Array.isArray(interfaces) ? interfaces : null;
      try {
        clipboard.writeText([
          'Lanvory network diagnostics',
          `Platform: ${process.platform} ${process.arch}`,
          `Application version: ${require('../../package.json').version}`,
          `Daemon build: ${typeof build === 'string' && /^(?:development|\d{1,8}\.\d{1,8}\.\d{1,8})$/.test(build) ? build : 'unavailable'}`,
          `Protocol version: ${Number.isSafeInteger(identity?.protocolVersion) ? identity.protocolVersion : 'unavailable'}`,
          `LAN listener: ${lan}`,
          `Network adapters: ${adapters?.length ?? 'unavailable'}`,
          `Approved adapters: ${adapters?.filter((adapter) => adapter?.approved === true).length ?? 'unavailable'}`,
        ].join('\n'));
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('lanvory:set-listener', async (event, action, adapter, bind, pairing) => {
      assertTrustedFrame(event);
      const args = ['network', 'listener'];
      if (action === 'stop') {
        args.push('stop');
      } else if (action === 'start' && typeof adapter === 'string' && /^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          && typeof bind === 'string' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(bind)
          && typeof pairing === 'boolean') {
        args.push('start', adapter, bind);
        if (!pairing) args.push('--no-pairing');
      } else {
        return null;
      }
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 4096 });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:check-scope', async (event, adapter, address) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof address !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(address)) return null;
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['network', 'check', adapter, address],
          { timeout: 4000, maxBuffer: 4096 });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:interface-approval', async (event, adapter, approved) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof approved !== 'boolean') return false;
      return exec(path.join(bundle, 'lanvory'), ['network', approved ? 'approve' : 'revoke', adapter], {
        timeout: 4000, maxBuffer: 4096,
      }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:discover', async (event) => {
      assertTrustedFrame(event);
      discoveryRequest ??= exec(path.join(bundle, 'lanvory'), ['discover'], {
        timeout: 4000,
        maxBuffer: 65536,
      }).then(({ stdout }) => JSON.parse(stdout)).catch(() => null).finally(() => {
        discoveryRequest = undefined;
      });
      return discoveryRequest;
    });
    ipcMain.handle('lanvory:discover-resolve', async (event, adapter, name) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
        || typeof name !== 'string' || !name || Buffer.byteLength(name) > 63 || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['discover', 'resolve', adapter, name, 'tcp'],
          { timeout: 6000, maxBuffer: 65536 });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:match-trusted-peer', async (event, adapter, endpoint) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)) return null;
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['peer', 'match-trusted', adapter, endpoint],
          { timeout: 4000, maxBuffer: 4096 });
        const pin = JSON.parse(stdout);
        return typeof pin === 'string' && /^[a-f0-9]{64}$/.test(pin) ? pin : null;
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:trusted-peers', async (event) => {
      assertTrustedFrame(event);
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['peer', 'trusted'], {
          timeout: 4000, maxBuffer: 65536,
        });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:pairing-requests', (event) => {
      assertTrustedFrame(event);
      return readPairingRequests();
    });
    ipcMain.handle('lanvory:pairing-start', async (event, adapter, endpoint, pin) => {
      assertTrustedFrame(event);
      if (activePair || typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
        || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
        || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) return 'failed';
      const controller = new AbortController();
      activePair = controller;
      try {
        await exec(path.join(bundle, 'lanvory'), ['peer', 'pair', adapter, endpoint, pin],
          { signal: controller.signal, timeout: 68000, maxBuffer: 4096 });
        return 'paired';
      } catch {
        return controller.signal.aborted ? 'cancelled' : 'failed';
      } finally {
        activePair = undefined;
      }
    });
    ipcMain.handle('lanvory:pairing-cancel', (event) => {
      assertTrustedFrame(event);
      activePair?.abort();
    });
    ipcMain.handle('lanvory:pairing-decision', (event, id, approve, code) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || typeof approve !== 'boolean') return false;
      const args = ['pairing', approve ? 'approve' : 'decline', id];
      if (approve) {
        if (typeof code !== 'string' || !/^(?:[a-fA-F0-9]{8}-){3}[a-fA-F0-9]{8}$|^[a-fA-F0-9]{32}$/.test(code)) return false;
        args.push(code);
      }
      return exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:update-trust', async (event, operation, fingerprint, adapter, endpoint) => {
      assertTrustedFrame(event);
      if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(fingerprint)) return false;
      let args;
      if (operation === 'revoke' && adapter === undefined && endpoint === undefined) {
        args = ['peer', 'revoke', fingerprint];
      } else if (operation === 'trust' && typeof adapter === 'string' && /^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          && typeof endpoint === 'string' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)) {
        args = ['peer', 'trust', adapter, endpoint, fingerprint];
      } else {
        return false;
      }
      if (trustRequest) return false;
      trustRequest = exec(path.join(bundle, 'lanvory'), args, {
        timeout: 4000, maxBuffer: 4096,
      }).then(() => true, () => false).finally(() => {
        trustRequest = undefined;
      });
      return trustRequest;
    });
    ipcMain.handle('lanvory:open-notices', async (event) => {
      assertTrustedFrame(event);
      if (!app.isPackaged) return 'unavailable';
      try {
        const notices = path.join(process.resourcesPath, 'Notices');
        if (!lstatSync(notices).isDirectory()) return 'failed';
        return await shell.openPath(notices) === '' ? 'opened' : 'failed';
      } catch {
        return 'failed';
      }
    });
    ipcMain.handle('lanvory:open-tunnel-url', async (event, endpoint) => {
      assertTrustedFrame(event);
      if (typeof endpoint !== 'string') return false;
      const match = endpoint.trim().replace(/^https?:\/\//, '').match(/^(127\.0\.0\.1|localhost):([0-9]{1,5})$/);
      if (!match) return false;
      const port = parseInt(match[2], 10);
      if (port < 1 || port > 65535) return false;
      try {
        await shell.openExternal(`http://127.0.0.1:${port}`);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('lanvory:open-inbox', async (event) => {
      assertTrustedFrame(event);
      const state = process.env.LANVORY_STATE_DIR || path.join(app.getPath('home'), '.lanvory');
      if (!path.isAbsolute(state)) return 'failed';
      const inbox = path.join(state, 'inbox');
      try {
        for (const directory of [state, inbox]) {
          const info = lstatSync(directory);
          if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.geteuid?.()) return 'failed';
        }
        return await shell.openPath(inbox) === '' ? 'opened' : 'failed';
      } catch (error) {
        return error.code === 'ENOENT' ? 'missing' : 'failed';
      }
    });
    ipcMain.handle('lanvory:permission-activity', async (event) => {
      assertTrustedFrame(event);
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['permissions', 'audit'], { timeout: 4000, maxBuffer: 65536 });
        return JSON.parse(stdout);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:inbox-access', async (event) => {
      assertTrustedFrame(event);
      try {
        const [peers, grants] = await Promise.all([['peer', 'trusted'], ['permissions', 'list']].map(async (args) => {
          const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 131072 });
          return JSON.parse(stdout);
        }));
        return { peers, grants: grants.filter((grant) => grant.capability === 'file-receive' && grant.resource === 'inbox') };
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:set-inbox-access', (event, fingerprint, allowed, duration = 'until-revoked') => {
      assertTrustedFrame(event);
      if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint) || typeof allowed !== 'boolean') return false;
      const args = permissionArgs(allowed ? 'grant' : 'revoke', fingerprint, 'file-receive', 'inbox', duration);
      if (!args) return false;
      return exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:file-snapshot', async (event) => {
      assertTrustedFrame(event);
      fileSnapshot ??= Promise.all(['incoming', 'transfers'].map((action) =>
        exec(path.join(bundle, 'lanvory'), ['files', action], { timeout: 4000, maxBuffer: 65536 })
          .then(({ stdout }) => JSON.parse(stdout))
      )).then(([offers, activity]) => ({ offers, ...activity })).catch(() => null).finally(() => {
        fileSnapshot = undefined;
      });
      return fileSnapshot;
    });
    ipcMain.handle('lanvory:delete-transfer-history', async (event, id) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return false;
      return exec(path.join(bundle, 'lanvory'), ['files', 'remove-history', id],
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:clear-transfer-history', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['files', 'clear-history'],
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:decide-file', async (event, id, allow) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || typeof allow !== 'boolean') return false;
      return exec(path.join(bundle, 'lanvory'), ['files', allow ? 'approve' : 'decline', id],
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:select-file', async (event) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen) return null;
      filePickerOpen = true;
      try {
        const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
        if (result.canceled || !result.filePaths.length || !window || event.sender !== window.webContents) return null;
        const paths = result.filePaths.slice(0, 50);
        selectedFiles = paths;
        return paths.length === 1 ? path.basename(paths[0]) : paths.map((filePath) => path.basename(filePath));
      } finally {
        filePickerOpen = false;
      }
    });
    ipcMain.handle('lanvory:select-folder', async (event) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen) return null;
      filePickerOpen = true;
      try {
        const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths[0] || !window || event.sender !== window.webContents) return null;
        const rootDir = result.filePaths[0];
        const collected = [];
        const walk = (dir) => {
          if (collected.length >= 50) return;
          let entries;
          try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (collected.length >= 50) break;
            if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
            const fullPath = path.join(dir, entry.name);
            if (Buffer.byteLength(fullPath) > 1000) continue;
            if (entry.isDirectory()) walk(fullPath);
            else if (entry.isFile()) collected.push(fullPath);
          }
        };
        walk(rootDir);
        if (!collected.length) return null;
        selectedFiles = collected;
        return collected.map((filePath) => path.relative(rootDir, filePath) || path.basename(filePath));
      } finally {
        filePickerOpen = false;
      }
    });
    ipcMain.handle('lanvory:clear-selected-file', (event) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen) return false;
      selectedFiles = [];
      return true;
    });
    ipcMain.handle('lanvory:remove-selected-file', (event, index) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen || typeof index !== 'number' || !Number.isInteger(index)
          || index < 0 || index >= selectedFiles.length) return null;
      selectedFiles = selectedFiles.filter((_, currentIndex) => currentIndex !== index);
      return selectedFiles.map((filePath) => path.basename(filePath));
    });
    ipcMain.handle('lanvory:selected-files', (event) => {
      assertTrustedFrame(event);
      return selectedFiles.map((filePath) => path.basename(filePath));
    });
    ipcMain.handle('lanvory:select-dropped-file', (event, filename) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen || typeof filename !== 'string' || !path.isAbsolute(filename)
          || Buffer.byteLength(filename) > 1000) return null;
      try {
        if (!lstatSync(filename).isFile()) return null;
        selectedFiles = [filename];
        return path.basename(filename);
      } catch {
        return null;
      }
    });
    ipcMain.handle('lanvory:select-dropped-files', (event, filenames) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen || !Array.isArray(filenames) || !filenames.length) return null;
      const valid = [];
      const seen = new Set();
      for (const filename of filenames) {
        if (valid.length >= 50) break;
        if (typeof filename !== 'string' || !path.isAbsolute(filename) || Buffer.byteLength(filename) > 1000 || seen.has(filename)) continue;
        try {
          if (lstatSync(filename).isFile()) {
            seen.add(filename);
            valid.push(filename);
          }
        } catch {
          // Ignore non-regular or unreadable dropped entries.
        }
      }
      if (!valid.length) return null;
      selectedFiles = valid;
      return valid.map((filePath) => path.basename(filePath));
    });
    ipcMain.handle('lanvory:send-file', async (event, adapter, endpoint, pin) => {
      assertTrustedFrame(event);
      if (activeSend || filePickerOpen || !selectedFiles.length || typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) return 'failed';
      const controller = new AbortController();
      activeSend = controller;
      try {
        const queue = [...selectedFiles];
        for (const filePath of queue) {
          if (controller.signal.aborted) return 'cancelled';
          await exec(path.join(bundle, 'lanvory'), ['files', 'send', adapter, endpoint, pin, filePath],
            { timeout: 245000, maxBuffer: 4096, signal: controller.signal });
          selectedFiles = selectedFiles.filter((item) => item !== filePath);
        }
        return 'completed';
      } catch {
        return controller.signal.aborted ? 'cancelled' : 'failed';
      } finally {
        activeSend = undefined;
      }
    });
    ipcMain.handle('lanvory:cancel-file-send', (event) => {
      assertTrustedFrame(event);
      activeSend?.abort();
    });
    ipcMain.handle('lanvory:ping-peer', async (event, adapter, endpoint, pin) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) {
        return { verified: false, error: 'Invalid adapter, endpoint, or device ID.' };
      }
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['peer', 'ping', adapter, endpoint, pin, '--json'],
          { timeout: 7000, maxBuffer: 4096 });
        const parsed = JSON.parse(stdout);
        return { verified: Boolean(parsed.verified), latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : undefined };
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim() ? err.stderr.trim().replace(/^lanvory:\s*/, '') : 'Peer unreachable or verification failed.';
        return { verified: false, error: detail };
      }
    });
    ipcMain.handle('lanvory:clipboard-state', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['clipboard', 'status'], { timeout: 3000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:clipboard-policy', async (event, enabled) => {
      assertTrustedFrame(event);
      if (typeof enabled !== 'boolean') return null;
      return exec(path.join(bundle, 'lanvory'), ['clipboard', enabled ? 'enable' : 'disable'], { timeout: 3000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:set-clipboard-access', async (event, fingerprint, allowed, duration) => {
      assertTrustedFrame(event);
      if (typeof fingerprint !== 'string' || !/^[a-fA-F0-9]{64}$/.test(fingerprint) || typeof allowed !== 'boolean') return false;
      return exec(path.join(bundle, 'lanvory'), permissionArgs(allowed ? 'grant' : 'revoke', fingerprint, 'clipboard-share', 'clipboard', duration),
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:clipboard-clear', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['clipboard', 'clear'], { timeout: 3000, maxBuffer: 4096 })
        .then(() => true, () => false);
    });
    ipcMain.handle('lanvory:clipboard-send', async (event, adapter, endpoint, pin, text) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) {
        return { ok: false, error: 'Invalid adapter, endpoint, or peer ID.' };
      }
      const payload = typeof text === 'string' && text.length ? text : clipboard.readText();
      if (!payload || Buffer.byteLength(payload, 'utf8') > 65536) {
        return { ok: false, error: 'Clipboard text must be between 1 byte and 64 KiB.' };
      }
      try {
        await exec(path.join(bundle, 'lanvory'), ['clipboard', 'send', adapter, endpoint, pin, payload], { timeout: 4000, maxBuffer: 4096 });
        return { ok: true };
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim() ? err.stderr.trim().replace(/^lanvory:\s*/, '') : 'Clipboard send failed.';
        return { ok: false, error: detail };
      }
    });
    ipcMain.handle('lanvory:clipboard-copy-latest', (event, text) => {
      assertTrustedFrame(event);
      if (typeof text !== 'string' || !text.length || Buffer.byteLength(text, 'utf8') > 65536) return false;
      clipboard.writeText(text);
      return true;
    });
    ipcMain.handle('lanvory:sync-folders', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['sync', 'list'], { timeout: 4000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:sync-pick-dir', async (event) => {
      assertTrustedFrame(event);
      if (filePickerOpen) return null;
      filePickerOpen = true;
      try {
        const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths[0] || !window || event.sender !== window.webContents) return null;
        return result.filePaths[0];
      } finally {
        filePickerOpen = false;
      }
    });
    ipcMain.handle('lanvory:sync-add', async (event, id, folderPath, mode) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)
          || typeof folderPath !== 'string' || !path.isAbsolute(folderPath)
          || !['send-only', 'receive-only', 'bidirectional'].includes(mode)) {
        return { error: 'Enter a valid lowercase folder ID and directory path.' };
      }
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), ['sync', 'add', id, folderPath, mode], { timeout: 4000, maxBuffer: 131072 });
        return JSON.parse(stdout);
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim() ? err.stderr.trim().replace(/^lanvory:\s*/, '') : 'Unable to register sync folder.';
        return { error: detail };
      }
    });
    ipcMain.handle('lanvory:sync-remove', async (event, id) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return false;
      return exec(path.join(bundle, 'lanvory'), ['sync', 'remove', id], { timeout: 4000, maxBuffer: 4096 })
        .then(() => true, () => false);
    });
    ipcMain.handle('lanvory:sync-scan', async (event, id) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return null;
      return exec(path.join(bundle, 'lanvory'), ['sync', 'scan', id], { timeout: 10000, maxBuffer: 524288 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:sync-pause', async (event, id, paused) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || typeof paused !== 'boolean') return null;
      return exec(path.join(bundle, 'lanvory'), ['sync', paused ? 'pause' : 'resume', id], { timeout: 4000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:set-sync-access', async (event, fingerprint, folderId, allowed) => {
      assertTrustedFrame(event);
      if (typeof fingerprint !== 'string' || !/^[a-fA-F0-9]{64}$/.test(fingerprint)
          || typeof folderId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(folderId)
          || typeof allowed !== 'boolean') return false;
      return exec(path.join(bundle, 'lanvory'), permissionArgs(allowed ? 'grant' : 'revoke', fingerprint, 'folder-sync', folderId, 'until-revoked'),
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:sync-run', async (event, id, adapter, endpoint, pin, peerLabel) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)
          || typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) {
        return { error: 'Invalid folder ID, adapter, endpoint, or device ID.' };
      }
      const args = ['sync', 'run', id, adapter, endpoint, pin];
      if (typeof peerLabel === 'string' && peerLabel.trim()) {
        args.push(peerLabel.trim().slice(0, 48));
      }
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 125000, maxBuffer: 524288 });
        return JSON.parse(stdout);
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim()
          ? err.stderr.trim().replace(/^lanvory:\s*/, '')
          : 'Unable to sync folder with peer.';
        return { error: detail };
      }
    });
    ipcMain.handle('lanvory:mount-exports', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['mounts', 'exports'], { timeout: 4000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:mount-export', async (event, id, folderPath, readOnly) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)
          || typeof folderPath !== 'string' || !path.isAbsolute(folderPath)
          || typeof readOnly !== 'boolean') {
        return { error: 'Invalid mount ID, folder path, or access mode.' };
      }
      const args = ['mounts', 'export', id, folderPath];
      if (!readOnly) args.push('--rw');
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 65536 });
        return JSON.parse(stdout);
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim()
          ? err.stderr.trim().replace(/^lanvory:\s*/, '')
          : 'Unable to export folder for live mount.';
        return { error: detail };
      }
    });
    ipcMain.handle('lanvory:mount-unexport', async (event, id) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return false;
      return exec(path.join(bundle, 'lanvory'), ['mounts', 'unexport', id], { timeout: 4000, maxBuffer: 4096 })
        .then(() => true, () => false);
    });
    ipcMain.handle('lanvory:set-mount-access', async (event, fingerprint, mountId, allowed) => {
      assertTrustedFrame(event);
      if (typeof fingerprint !== 'string' || !/^[a-fA-F0-9]{64}$/.test(fingerprint)
          || typeof mountId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(mountId)
          || typeof allowed !== 'boolean') return false;
      return exec(path.join(bundle, 'lanvory'), permissionArgs(allowed ? 'grant' : 'revoke', fingerprint, 'folder-mount', mountId, 'until-revoked'),
        { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ipcMain.handle('lanvory:mounts', async (event) => {
      assertTrustedFrame(event);
      return exec(path.join(bundle, 'lanvory'), ['mounts', 'list'], { timeout: 4000, maxBuffer: 131072 })
        .then(({ stdout }) => JSON.parse(stdout), () => null);
    });
    ipcMain.handle('lanvory:mount-open', async (event, adapter, endpoint, pin, remoteId, mountPoint) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)
          || typeof remoteId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(remoteId)) {
        return { error: 'Invalid adapter, endpoint, device ID, or remote mount ID.' };
      }
      const args = ['mounts', 'open', adapter, endpoint, pin, remoteId];
      if (typeof mountPoint === 'string' && mountPoint.trim() && path.isAbsolute(mountPoint.trim())) {
        args.push(mountPoint.trim());
      }
      try {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 15000, maxBuffer: 131072 });
        return JSON.parse(stdout);
      } catch (err) {
        const detail = typeof err?.stderr === 'string' && err.stderr.trim()
          ? err.stderr.trim().replace(/^lanvory:\s*/, '')
          : 'Unable to open live mount.';
        return { error: detail };
      }
    });
    ipcMain.handle('lanvory:mount-close', async (event, id) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return false;
      return exec(path.join(bundle, 'lanvory'), ['mounts', 'close', id], { timeout: 8000, maxBuffer: 4096 })
        .then(() => true, () => false);
    });
    ipcMain.handle('lanvory:mount-open-finder', async (event, target) => {
      assertTrustedFrame(event);
      if (typeof target !== 'string' || !target.trim()) return false;
      const trimmed = target.trim();
      if (/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/$/.test(trimmed)) {
        await shell.openExternal(trimmed);
        return true;
      }
      if (path.isAbsolute(trimmed)) {
        const err = await shell.openPath(trimmed);
        return err === '';
      }
      return false;
    });

    function requestDaemon(method, routePath, payload) {
      return new Promise((resolve, reject) => {
        const stateDir = process.env.LANVORY_STATE_DIR || path.join(app.getPath('home'), '.lanvory');
        const body = payload !== undefined ? JSON.stringify(payload) : null;
        const req = http.request({
          socketPath: path.join(stateDir, 'daemon.sock'),
          path: routePath,
          method,
          timeout: 12000,
          headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode >= 400) {
              reject(new Error(text.trim() || `Daemon HTTP ${res.statusCode}`));
              return;
            }
            if (!text.trim()) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Daemon request timed out')); });
        if (body) req.write(body);
        req.end();
      });
    }

    ipcMain.handle('lanvory:mount-discover', async (event, adapter, endpoint, pin) => {
      assertTrustedFrame(event);
      if (typeof adapter !== 'string' || !/^[a-zA-Z0-9_.-]{1,32}$/.test(adapter)
          || typeof endpoint !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(endpoint)
          || typeof pin !== 'string' || !/^[a-fA-F0-9]{64}$/.test(pin)) {
        return { error: 'Invalid adapter, endpoint, or peer ID.' };
      }
      return requestDaemon('POST', '/v1/mounts/discover', { interface: adapter, endpoint, fingerprint: pin })
        .catch((err) => ({ error: err?.message || 'Unable to discover remote resources.' }));
    });

    ipcMain.handle('lanvory:mount-native', async (event, id, mountPoint) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return { error: 'Invalid resource session ID.' };
      }
      const payload = typeof mountPoint === 'string' && path.isAbsolute(mountPoint.trim()) ? { mountPoint: mountPoint.trim() } : {};
      return requestDaemon('POST', `/v1/mounts/${encodeURIComponent(id)}/native`, payload)
        .catch((err) => ({ error: err?.message || 'Unable to mount in Finder.' }));
    });

    ipcMain.handle('lanvory:mount-browse', async (event, id, subPath) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return { error: 'Invalid resource session ID.' };
      }
      const cleanPath = typeof subPath === 'string' && subPath.trim() ? subPath.trim() : '/';
      return requestDaemon('GET', `/v1/mounts/${encodeURIComponent(id)}/browse?path=${encodeURIComponent(cleanPath)}`)
        .catch((err) => ({ error: err?.message || 'Unable to browse remote directory.' }));
    });

    ipcMain.handle('lanvory:mount-stream', async (event, id, filePath, offset, length, etag) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)
          || typeof filePath !== 'string' || !filePath.trim()) {
        return { error: 'Invalid resource session or file path.' };
      }
      const off = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
      const len = Number.isFinite(length) && length > 0 ? Math.floor(length) : 65536;
      const q = new URLSearchParams({ path: filePath.trim(), offset: String(off), length: String(len) });
      if (typeof etag === 'string' && etag) q.set('etag', etag);
      return requestDaemon('GET', `/v1/mounts/${encodeURIComponent(id)}/stream?${q.toString()}`)
        .catch((err) => ({ error: err?.message || 'Unable to stream remote file.' }));
    });

    ipcMain.handle('lanvory:mount-mkdir', async (event, id, dirPath) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof dirPath !== 'string' || !dirPath.trim()) {
        return { ok: false, error: 'Invalid directory path.' };
      }
      return requestDaemon('POST', `/v1/mounts/${encodeURIComponent(id)}/mkdir`, { path: dirPath.trim() })
        .then(() => ({ ok: true }), (err) => ({ ok: false, error: err?.message || 'Unable to create directory.' }));
    });

    ipcMain.handle('lanvory:mount-delete-entry', async (event, id, targetPath) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof targetPath !== 'string' || !targetPath.trim()) {
        return { ok: false, error: 'Invalid target path.' };
      }
      return requestDaemon('DELETE', `/v1/mounts/session/${encodeURIComponent(id)}/entry?path=${encodeURIComponent(targetPath.trim())}`)
        .then(() => ({ ok: true }), (err) => ({ ok: false, error: err?.message || 'Unable to delete entry.' }));
    });

    ipcMain.handle('lanvory:mount-rename', async (event, id, oldPath, newPath) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)
          || typeof oldPath !== 'string' || !oldPath.trim()
          || typeof newPath !== 'string' || !newPath.trim()) {
        return { ok: false, error: 'Invalid rename paths.' };
      }
      return requestDaemon('POST', `/v1/mounts/${encodeURIComponent(id)}/rename`, { path: oldPath.trim(), newPath: newPath.trim() })
        .then(() => ({ ok: true }), (err) => ({ ok: false, error: err?.message || 'Unable to rename entry.' }));
    });

    ipcMain.handle('lanvory:mount-events', async (event, id, since) => {
      assertTrustedFrame(event);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return { error: 'Invalid resource session ID.' };
      }
      const seq = Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
      return requestDaemon('GET', `/v1/mounts/${encodeURIComponent(id)}/events?since=${seq}`)
        .catch((err) => ({ error: err?.message || 'Unable to fetch resource events.' }));
    });
    ipcMain.handle('lanvory:service-snapshot', async (event) => {
      assertTrustedFrame(event);
      const commands = [['services', 'list'], ['tunnels', 'list'], ['permissions', 'list'], ['peer', 'trusted']];
      serviceSnapshot ??= Promise.all(commands.map(async (args) => {
        const { stdout } = await exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 131072 });
        return JSON.parse(stdout);
      })).then(([services, tunnels, grants, peers]) => ({ services, tunnels, grants, peers })).catch(() => null).finally(() => {
        serviceSnapshot = undefined;
      });
      return serviceSnapshot;
    });
    ipcMain.handle('lanvory:service-action', async (event, action, input) => {
      assertTrustedFrame(event);
      if (!input || typeof input !== 'object') return false;
      const { id, target, bind, adapter, endpoint, fingerprint, duration } = input;
      const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
      const serviceID = matches(id, /^[a-z0-9][a-z0-9_-]{0,63}$/);
      const pin = matches(fingerprint, /^[a-fA-F0-9]{64}$/);
      const loopback = (value) => matches(value, /^(?:127(?:\.[0-9]{1,3}){3}|\[::1\]):[0-9]{1,5}$/);
      let args;
      if (action === 'share' && serviceID && loopback(target)) {
        args = ['services', 'share', id, target];
      } else if (action === 'remove' && serviceID) {
        args = ['services', 'remove', id];
      } else if ((action === 'grant' || action === 'revoke') && serviceID && pin) {
        args = permissionArgs(action, fingerprint, 'service-connect', id, duration);
        if (!args) return false;
      } else if (action === 'open' && serviceID && pin && (bind === '' || loopback(bind)) &&
        matches(adapter, /^[a-zA-Z0-9_.-]{1,32}$/) && matches(endpoint, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/)) {
        args = ['tunnels', 'open', adapter, endpoint, fingerprint, id, bind || '127.0.0.1:0'];
      } else if (action === 'stop' && matches(id, /^[a-f0-9]{32}$/)) {
        args = ['tunnels', 'stop', id];
      } else {
        return false;
      }
      return exec(path.join(bundle, 'lanvory'), args, { timeout: 4000, maxBuffer: 4096 }).then(() => true, () => false);
    });
    ready = true;
    if (process.platform === 'darwin') {
      menuBar = createMenuBar({
        open: openWindow,
        navigate: (targetPage) => {
          openWindow();
          if (['Devices', 'Sharing', 'Services', 'Network', 'Settings'].includes(targetPage)) {
            window?.webContents.send('lanvory:navigate', targetPage);
          }
        },
        retry: () => { void daemonStatus(true); },
        quit: () => app.quit(),
      });
      if (menuBar) backgroundCheck = setInterval(() => {
        if (window?.isVisible()) return;
        void daemonStatus();
        if (pairingAlertsEnabled()) {
          void readPairingRequests().then((requests) => {
            if (!stopping && !window?.isVisible() && pairingAlertsEnabled()) alertPairing(requests);
          });
          void exec(path.join(bundle, 'lanvory'), ['files', 'incoming'], { timeout: 3000, maxBuffer: 16384 })
            .then(({ stdout }) => JSON.parse(stdout), () => null)
            .then((offers) => {
              if (stopping || window?.isVisible() || !Array.isArray(offers) || !pairingAlertsEnabled()) return;
              const unseen = offers.filter((offer) => offer?.id && !notifiedOffers.has(offer.id));
              if (!unseen.length) return;
              for (const offer of unseen) notifiedOffers.add(offer.id);
              const notice = new Notification({
                title: unseen.length === 1 ? `File request: ${unseen[0].name}` : `${unseen.length} incoming file requests`,
                body: 'Open Lanvory to approve or decline.',
              });
              notice.once('click', () => {
                openWindow();
                window?.webContents.send('lanvory:navigate', 'Sharing');
              });
              notice.show();
            });
        }
      }, 8000);
    }
    void daemonStatus(true);
    await createWindow(!menuBar || !existsSync(profileFlag('start-minimized')));
  }).catch(failStartup);
  app.on('before-quit', (event) => {
    if (quitWait) {
      event.preventDefault();
      return;
    }
    if (stopping) return;
    stopping = true;
    clearTimeout(recoveryTimer);
    clearInterval(backgroundCheck);
    pairingNotification?.close();
    pairingNotification = undefined;
    window?.hide();
    menuBar?.destroy();
    menuBar = undefined;
    activeSend?.abort();
    activePair?.abort();
    if (daemon?.pid && daemon.exitCode == null && daemon.signalCode == null) {
      event.preventDefault();
      quitWait = stopOwnedDaemon(daemon).finally(() => {
        quitWait = undefined;
        app.quit();
      });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
